import { Inject, Injectable, Logger } from '@nestjs/common';
import 'multer';
import {
  AppBadRequestException,
  AppInternalServerErrorException,
  AppNotFoundException,
} from '../common/errors/app.exception';
import { ErrorCode } from '../common/errors/error-codes';
import { PrismaService } from '../prisma/prisma.service';
import { Prisma } from '@prisma/client';
import {
  CreateActivityDto,
  UpdateActivityDto,
  RecordAttendanceDto,
  ActivityFiltersDto,
} from './dto';
import {
  PaginationDto,
  PaginatedResult,
  createPaginatedResult,
} from '../common/dto/pagination.dto';
import {
  FILE_STORAGE_SERVICE,
  StorageBucketAlias,
} from '../common/services/file-storage.service';
import type { FileStorageService } from '../common/services/file-storage.service';
import { NotificationsService } from '../notifications/notifications.service';
import { AchievementsService } from '../achievements/achievements.service';

@Injectable()
export class ActivitiesService {
  private static readonly PRIVATE_ASSET_URL_TTL_SECONDS = 300;
  private readonly logger = new Logger(ActivitiesService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(FILE_STORAGE_SERVICE)
    private readonly fileStorage: FileStorageService,
    private readonly notificationsService: NotificationsService,
    private readonly achievementsService: AchievementsService,
  ) {}

  private readonly activityInclude = {
    activity_types: {
      select: { activity_type_id: true, code: true, name: true },
    },
    club_types: { select: { name: true } },
    users: {
      select: { name: true, paternal_last_name: true, user_image: true },
    },
    club_sections: {
      select: {
        club_section_id: true,
        main_club_id: true,
        club_types: { select: { name: true } },
      },
    },
    activity_instances: {
      where: { active: true },
      orderBy: { activity_instance_id: 'asc' },
      select: {
        activity_instance_id: true,
        club_section_id: true,
        club_sections: {
          select: {
            club_section_id: true,
            main_club_id: true,
            club_types: { select: { name: true } },
          },
        },
      },
    },
  } as const;

  // ========================================
  // ACTIVIDADES
  // ========================================

  async findByClub(
    clubId: number,
    filters?: ActivityFiltersDto,
    pagination?: PaginationDto,
    /**
     * When provided, results are scoped to activity_instances belonging to
     * this specific section (mirrors the check in PermissionsGuard.validateInstanceScope).
     * Pass `null` to skip section filtering (admin / club-manager bypass).
     */
    userSectionId?: number | null,
  ): Promise<PaginatedResult<any>> {
    const club = await this.prisma.clubs.findUnique({
      where: { club_id: clubId },
      select: {
        club_sections: {
          select: { club_section_id: true, club_type_id: true },
        },
      },
    });

    if (!club) {
      throw new AppNotFoundException(ErrorCode.ACTIVITY_CLUB_NOT_FOUND);
    }

    // Build the activity_instances filter.
    // - Admin bypass (userSectionId === null): show all instances of the club.
    // - Regular member (userSectionId is a number): show only instances belonging
    //   to the user's active section (mirrors PermissionsGuard.validateInstanceScope).
    let instancesFilter: Prisma.activitiesWhereInput['activity_instances'];

    if (userSectionId == null) {
      // Admin or club-manager: filter by all sections of the club (optionally
      // narrowed by clubTypeId filter), preserving original broad behaviour.
      const sectionIds = club.club_sections
        .filter(
          (section) =>
            !filters?.clubTypeId || section.club_type_id === filters.clubTypeId,
        )
        .map((section) => section.club_section_id);

      if (sectionIds.length === 0) {
        return createPaginatedResult([], 0, pagination ?? new PaginationDto());
      }

      instancesFilter = {
        some: {
          active: true,
          club_section_id: { in: sectionIds },
        },
      };
    } else {
      // Regular member: only activities that have an active instance for their section.
      instancesFilter = {
        some: {
          active: true,
          club_section_id: userSectionId,
        },
      };
    }

    const where: Prisma.activitiesWhereInput = {
      activity_instances: instancesFilter,
      ...(filters?.active !== undefined && { active: filters.active }),
      ...(filters?.activityTypeId !== undefined && {
        activity_type_id: filters.activityTypeId,
      }),
    };

    const [data, total] = await Promise.all([
      this.prisma.activities.findMany({
        where,
        include: this.activityInclude,
        orderBy: { created_at: 'desc' },
        skip: pagination?.skip ?? 0,
        take: pagination?.take ?? 20,
      }),
      this.prisma.activities.count({ where }),
    ]);

    const signedActivities = await Promise.all(
      data.map((activity) =>
        this.applySignedPrivateUrls(this.attachInstances(activity)),
      ),
    );

    return createPaginatedResult(
      signedActivities,
      total,
      pagination ?? new PaginationDto(),
    );
  }

  async findOne(activityId: number) {
    const activity = await this.prisma.activities.findUnique({
      where: { activity_id: activityId },
      include: this.activityInclude,
    });

    if (!activity) {
      throw new AppNotFoundException(ErrorCode.ACTIVITY_NOT_FOUND);
    }

    return this.applySignedPrivateUrls(this.attachInstances(activity));
  }

  async create(clubId: number, dto: CreateActivityDto, createdBy: string) {
    const isJoint = Boolean(
      dto.club_section_ids && dto.club_section_ids.length >= 2,
    );

    if (isJoint) {
      return this.createJointActivity(clubId, dto, createdBy);
    }

    // Single-section activity (existing path)
    if (!dto.club_section_id) {
      throw new AppBadRequestException(ErrorCode.ACTIVITY_SECTION_ID_REQUIRED);
    }

    const section = await this.resolveAndValidateSectionRecord(
      clubId,
      dto.club_section_id,
    );
    const clubTypeId = dto.club_type_id ?? section.club_type_id;

    const created = await this.prisma.activities.create({
      data: {
        name: dto.name,
        description: dto.description,
        club_type_id: clubTypeId,
        lat: dto.lat,
        long: dto.long,
        activity_time: dto.activity_time || '09:00',
        activity_date: dto.activity_date ? new Date(dto.activity_date) : null,
        activity_end_date: dto.activity_end_date
          ? new Date(dto.activity_end_date)
          : null,
        activity_place: dto.activity_place,
        image: dto.image ?? '',
        platform: dto.platform || 0,
        activity_type_id: dto.activity_type_id,
        link_meet: dto.link_meet,
        additional_data: dto.additional_data,
        classes: dto.classes
          ? (dto.classes as Prisma.InputJsonValue)
          : Prisma.JsonNull,
        created_by: createdBy,
        club_section_id: section.club_section_id,
        is_joint: false,
        active: true,
        created_at: new Date(),
        modified_at: new Date(),
        activity_instances: {
          create: [
            {
              club_section_id: section.club_section_id,
              active: true,
              created_at: new Date(),
              modified_at: new Date(),
            },
          ],
        },
      },
      include: this.activityInclude,
    });

    // Fire-and-forget: notify section members about the new activity
    this.sendActivityCreatedNotification(created, section.club_section_id);

    // Fire-and-forget: realtime cache invalidation for section peers
    this.emitRealtimeInvalidation(
      section.club_section_id,
      created.activity_id,
      'CREATED',
      createdBy,
    );

    return this.applySignedPrivateUrls(this.attachInstances(created));
  }

  private async createJointActivity(
    clubId: number,
    dto: CreateActivityDto,
    createdBy: string,
  ) {
    // W4: Reject duplicate section IDs early
    const rawSectionIds = dto.club_section_ids!;
    const uniqueSectionIds = [...new Set(rawSectionIds)];
    if (uniqueSectionIds.length !== rawSectionIds.length) {
      throw new AppBadRequestException(
        ErrorCode.ACTIVITY_SECTION_DUPLICATE_IDS,
      );
    }

    // W1: Ensure the creator's own section is always present in the instances list
    if (
      dto.club_section_id &&
      !uniqueSectionIds.includes(dto.club_section_id)
    ) {
      uniqueSectionIds.push(dto.club_section_id);
    }

    const sections = await this.resolveAndValidateMultipleSections(
      clubId,
      uniqueSectionIds,
    );

    // W1: Use dto.club_section_id as the primary/owner section.
    // Fall back to the first validated section only if club_section_id was not provided.
    const primarySectionRecord = dto.club_section_id
      ? sections.find((s) => s.club_section_id === dto.club_section_id)
      : sections[0];

    if (!primarySectionRecord) {
      throw new AppBadRequestException(
        ErrorCode.ACTIVITY_SECTION_OWNER_NOT_IN_LIST,
      );
    }

    // W2: If club_type_id is explicitly provided, verify it matches the owner section
    if (
      dto.club_type_id &&
      dto.club_type_id !== primarySectionRecord.club_type_id
    ) {
      throw new AppBadRequestException(
        ErrorCode.ACTIVITY_SECTION_CLUB_TYPE_MISMATCH,
      );
    }

    const clubTypeId = dto.club_type_id ?? primarySectionRecord.club_type_id;

    const now = new Date();

    const created = await this.prisma.activities.create({
      data: {
        name: dto.name,
        description: dto.description,
        club_type_id: clubTypeId,
        lat: dto.lat,
        long: dto.long,
        activity_time: dto.activity_time || '09:00',
        activity_date: dto.activity_date ? new Date(dto.activity_date) : null,
        activity_end_date: dto.activity_end_date
          ? new Date(dto.activity_end_date)
          : null,
        activity_place: dto.activity_place,
        image: dto.image ?? '',
        platform: dto.platform || 0,
        activity_type_id: dto.activity_type_id,
        link_meet: dto.link_meet,
        additional_data: dto.additional_data,
        classes: dto.classes
          ? (dto.classes as Prisma.InputJsonValue)
          : Prisma.JsonNull,
        created_by: createdBy,
        club_section_id: primarySectionRecord.club_section_id,
        is_joint: true,
        active: true,
        created_at: now,
        modified_at: now,
        activity_instances: {
          create: sections.map((section) => ({
            club_section_id: section.club_section_id,
            active: true,
            created_at: now,
            modified_at: now,
          })),
        },
      },
      include: this.activityInclude,
    });

    // Fire-and-forget: notify ALL participating sections
    for (const section of sections) {
      this.sendActivityCreatedNotification(
        created,
        section.club_section_id,
        true,
      );
      // Realtime cache invalidation per participating section
      this.emitRealtimeInvalidation(
        section.club_section_id,
        created.activity_id,
        'CREATED',
        createdBy,
      );
    }

    return this.applySignedPrivateUrls(this.attachInstances(created));
  }

  /**
   * Fire-and-forget realtime cache invalidation.
   * Enqueues a silent FCM push so active section peers can refresh their
   * local activity cache without the actor triggering their own refresh.
   *
   * sectionId may be null for activities not yet assigned to a section;
   * in that case the call is silently skipped.
   */
  private emitRealtimeInvalidation(
    sectionId: number | null | undefined,
    entityId: number,
    action: 'CREATED' | 'UPDATED' | 'DELETED',
    actorId?: string,
  ): void {
    if (!sectionId) return;

    this.notificationsService
      .sendSilentToSection({
        sectionId,
        resource: 'activities',
        action,
        entityId,
        actorId: actorId ?? 'system',
        timestamp: new Date().toISOString(),
      })
      .catch((err: Error) =>
        this.logger.error(
          `emitRealtimeInvalidation failed (section=${sectionId}, entity=${entityId}, action=${action}): ${err.message}`,
        ),
      );
  }

  private sendActivityCreatedNotification(
    activity: any,
    sectionId: number,
    isJoint = false,
  ): void {
    const dateLabel = activity.activity_date
      ? ` - ${activity.activity_date.toLocaleDateString('es-MX', { day: '2-digit', month: 'long', year: 'numeric' })}`
      : '';
    const title = isJoint
      ? 'Nueva actividad conjunta'
      : 'Nueva actividad programada';
    this.notificationsService
      .sendToClubMembers(
        sectionId,
        {
          title,
          body: `${activity.name}${dateLabel}`,
          data: {
            type: 'activity',
            entity_id: String(activity.activity_id),
            action: 'created',
          },
        },
        'system',
        'activities:created',
      )
      .catch((err: Error) =>
        this.logger.warn(
          `Failed to send activity-created notification (activity=${activity.activity_id}, section=${sectionId}): ${err.message}`,
        ),
      );
  }

  async update(activityId: number, dto: UpdateActivityDto, actorId?: string) {
    // Fetch the current record with its owner section so we can derive the club
    const existing = await this.prisma.activities.findUnique({
      where: { activity_id: activityId },
      select: {
        activity_id: true,
        club_section_id: true,
        is_joint: true,
        club_sections: {
          select: { main_club_id: true },
        },
      },
    });

    if (!existing) {
      throw new AppNotFoundException(ErrorCode.ACTIVITY_NOT_FOUND);
    }

    // -----------------------------------------------------------------------
    // Branch A: caller explicitly converts back to non-joint (is_joint: false)
    // -----------------------------------------------------------------------
    if (dto.is_joint === false && !dto.club_section_ids) {
      const result = await this.convertToSingleSection(
        activityId,
        existing,
        dto,
      );
      this.emitRealtimeInvalidation(
        existing.club_section_id,
        activityId,
        'UPDATED',
        actorId,
      );
      return result;
    }

    // -----------------------------------------------------------------------
    // Branch B: caller provides new section list — replace instances atomically
    // -----------------------------------------------------------------------
    if (dto.club_section_ids && dto.club_section_ids.length >= 2) {
      const result = await this.updateJointSections(activityId, existing, dto);
      this.emitRealtimeInvalidation(
        existing.club_section_id,
        activityId,
        'UPDATED',
        actorId,
      );
      return result;
    }

    // -----------------------------------------------------------------------
    // Branch C: plain field update — no instance changes
    // -----------------------------------------------------------------------
    const updateData: any = {
      modified_at: new Date(),
    };

    if (dto.name !== undefined) updateData.name = dto.name;
    if (dto.description !== undefined) updateData.description = dto.description;
    if (dto.lat !== undefined) updateData.lat = dto.lat;
    if (dto.long !== undefined) updateData.long = dto.long;
    if (dto.activity_time !== undefined) {
      updateData.activity_time = dto.activity_time;
      // Reset reminder so cron re-evaluates with the new time
      updateData.reminder_sent = false;
    }
    if (dto.activity_date !== undefined) {
      updateData.activity_date = dto.activity_date
        ? new Date(dto.activity_date)
        : null;
      // Reset reminder so cron re-evaluates with the new date
      updateData.reminder_sent = false;
    }
    if (dto.activity_end_date !== undefined)
      updateData.activity_end_date = dto.activity_end_date
        ? new Date(dto.activity_end_date)
        : null;
    if (dto.activity_place !== undefined)
      updateData.activity_place = dto.activity_place;
    if (dto.image !== undefined) updateData.image = dto.image;
    if (dto.platform !== undefined) updateData.platform = dto.platform;
    if (dto.activity_type_id !== undefined)
      updateData.activity_type_id = dto.activity_type_id;
    if (dto.link_meet !== undefined) updateData.link_meet = dto.link_meet;
    if (dto.active !== undefined) updateData.active = dto.active;
    if (dto.classes !== undefined)
      updateData.classes = dto.classes as Prisma.InputJsonValue;

    const updated = await this.prisma.activities.update({
      where: { activity_id: activityId },
      data: updateData,
      include: this.activityInclude,
    });

    const result = await this.applySignedPrivateUrls(
      this.attachInstances(updated),
    );
    this.emitRealtimeInvalidation(
      existing.club_section_id,
      activityId,
      'UPDATED',
      actorId,
    );
    return result;
  }

  /**
   * Replaces participating sections for a joint activity.
   * Uses a Prisma transaction to soft-delete existing active instances and
   * create the new ones, then updates the activity's is_joint flag.
   * The unique constraint (activity_id, club_section_id) is avoided because
   * we soft-delete (active=false) before inserting new rows — but old
   * inactive rows keep their unique slot. To handle that, we upsert instead:
   * reactivate a pre-existing inactive instance or create a fresh one.
   */
  private async updateJointSections(
    activityId: number,
    existing: {
      club_section_id: number | null;
      is_joint: boolean;
      club_sections: { main_club_id: number | null } | null;
    },
    dto: UpdateActivityDto,
  ) {
    const clubId = existing.club_sections?.main_club_id;

    if (!clubId) {
      throw new AppBadRequestException(ErrorCode.ACTIVITY_NO_OWNER_SECTION);
    }

    // Deduplicate
    const rawIds = dto.club_section_ids!;
    const uniqueSectionIds = [...new Set(rawIds)];
    if (uniqueSectionIds.length !== rawIds.length) {
      throw new AppBadRequestException(
        ErrorCode.ACTIVITY_SECTION_DUPLICATE_IDS,
      );
    }

    // Validate all sections belong to the same club
    await this.resolveAndValidateMultipleSections(clubId, uniqueSectionIds);

    const now = new Date();

    // Build scalar update fields (same fields as Branch C but filtered)
    const scalarUpdateData: any = { modified_at: now, is_joint: true };
    if (dto.name !== undefined) scalarUpdateData.name = dto.name;
    if (dto.description !== undefined)
      scalarUpdateData.description = dto.description;
    if (dto.lat !== undefined) scalarUpdateData.lat = dto.lat;
    if (dto.long !== undefined) scalarUpdateData.long = dto.long;
    if (dto.activity_time !== undefined) {
      scalarUpdateData.activity_time = dto.activity_time;
      scalarUpdateData.reminder_sent = false;
    }
    if (dto.activity_date !== undefined) {
      scalarUpdateData.activity_date = dto.activity_date
        ? new Date(dto.activity_date)
        : null;
      scalarUpdateData.reminder_sent = false;
    }
    if (dto.activity_end_date !== undefined)
      scalarUpdateData.activity_end_date = dto.activity_end_date
        ? new Date(dto.activity_end_date)
        : null;
    if (dto.activity_place !== undefined)
      scalarUpdateData.activity_place = dto.activity_place;
    if (dto.image !== undefined) scalarUpdateData.image = dto.image;
    if (dto.platform !== undefined) scalarUpdateData.platform = dto.platform;
    if (dto.activity_type_id !== undefined)
      scalarUpdateData.activity_type_id = dto.activity_type_id;
    if (dto.link_meet !== undefined) scalarUpdateData.link_meet = dto.link_meet;
    if (dto.active !== undefined) scalarUpdateData.active = dto.active;
    if (dto.classes !== undefined)
      scalarUpdateData.classes = dto.classes as Prisma.InputJsonValue;

    await this.prisma.$transaction([
      // 1. Soft-delete all currently active instances for this activity
      this.prisma.activity_instances.updateMany({
        where: { activity_id: activityId, active: true },
        data: { active: false, modified_at: now },
      }),
      // 2. Update the activity's scalar fields
      this.prisma.activities.update({
        where: { activity_id: activityId },
        data: scalarUpdateData,
      }),
    ]);

    // 3. Upsert each new instance in parallel — reactivate existing or create fresh.
    await Promise.all(
      uniqueSectionIds.map((sectionId) =>
        this.prisma.activity_instances.upsert({
          where: {
            activity_id_club_section_id: {
              activity_id: activityId,
              club_section_id: sectionId,
            },
          },
          update: { active: true, modified_at: now },
          create: {
            activity_id: activityId,
            club_section_id: sectionId,
            active: true,
            created_at: now,
            modified_at: now,
          },
        }),
      ),
    );

    const updated = await this.prisma.activities.findUnique({
      where: { activity_id: activityId },
      include: this.activityInclude,
    });

    return this.applySignedPrivateUrls(this.attachInstances(updated));
  }

  /**
   * Converts a joint activity back to a single-section activity.
   * Deactivates all instances except the owner's, sets is_joint=false.
   */
  private async convertToSingleSection(
    activityId: number,
    existing: {
      club_section_id: number | null;
      is_joint: boolean;
      club_sections: { main_club_id: number | null } | null;
    },
    dto: UpdateActivityDto,
  ) {
    const ownerSectionId = existing.club_section_id;

    if (!ownerSectionId) {
      throw new AppBadRequestException(ErrorCode.ACTIVITY_NO_OWNER_SECTION);
    }

    const now = new Date();

    const scalarUpdateData: any = { modified_at: now, is_joint: false };
    if (dto.name !== undefined) scalarUpdateData.name = dto.name;
    if (dto.description !== undefined)
      scalarUpdateData.description = dto.description;
    if (dto.lat !== undefined) scalarUpdateData.lat = dto.lat;
    if (dto.long !== undefined) scalarUpdateData.long = dto.long;
    if (dto.activity_time !== undefined) {
      scalarUpdateData.activity_time = dto.activity_time;
      scalarUpdateData.reminder_sent = false;
    }
    if (dto.activity_date !== undefined) {
      scalarUpdateData.activity_date = dto.activity_date
        ? new Date(dto.activity_date)
        : null;
      scalarUpdateData.reminder_sent = false;
    }
    if (dto.activity_end_date !== undefined)
      scalarUpdateData.activity_end_date = dto.activity_end_date
        ? new Date(dto.activity_end_date)
        : null;
    if (dto.activity_place !== undefined)
      scalarUpdateData.activity_place = dto.activity_place;
    if (dto.image !== undefined) scalarUpdateData.image = dto.image;
    if (dto.platform !== undefined) scalarUpdateData.platform = dto.platform;
    if (dto.activity_type_id !== undefined)
      scalarUpdateData.activity_type_id = dto.activity_type_id;
    if (dto.link_meet !== undefined) scalarUpdateData.link_meet = dto.link_meet;
    if (dto.active !== undefined) scalarUpdateData.active = dto.active;
    if (dto.classes !== undefined)
      scalarUpdateData.classes = dto.classes as Prisma.InputJsonValue;

    await this.prisma.$transaction([
      // Deactivate all instances except the owner's
      this.prisma.activity_instances.updateMany({
        where: {
          activity_id: activityId,
          active: true,
          NOT: { club_section_id: ownerSectionId },
        },
        data: { active: false, modified_at: now },
      }),
      // Ensure the owner's instance is active
      this.prisma.activity_instances.updateMany({
        where: { activity_id: activityId, club_section_id: ownerSectionId },
        data: { active: true, modified_at: now },
      }),
      // Update the activity record
      this.prisma.activities.update({
        where: { activity_id: activityId },
        data: scalarUpdateData,
      }),
    ]);

    const updated = await this.prisma.activities.findUnique({
      where: { activity_id: activityId },
      include: this.activityInclude,
    });

    return this.applySignedPrivateUrls(this.attachInstances(updated));
  }

  async remove(activityId: number, actorId?: string) {
    const existing = await this.prisma.activities.findUnique({
      where: { activity_id: activityId },
      select: { activity_id: true, club_section_id: true, active: true },
    });

    if (!existing) {
      throw new AppNotFoundException(ErrorCode.ACTIVITY_NOT_FOUND);
    }

    const deleted = await this.prisma.activities.update({
      where: { activity_id: activityId },
      data: {
        active: false,
        modified_at: new Date(),
      },
    });

    this.emitRealtimeInvalidation(
      existing.club_section_id,
      activityId,
      'DELETED',
      actorId,
    );

    return deleted;
  }

  // ========================================
  // ASISTENCIA
  // ========================================

  async recordAttendance(activityId: number, dto: RecordAttendanceDto) {
    const activity = await this.findOne(activityId);

    const attendees = dto.user_ids;

    const updated = await this.prisma.activities.update({
      where: { activity_id: activityId },
      data: {
        attendees: attendees,
        modified_at: new Date(),
      },
    });

    // Emit activity.attended for each attending user — fire-and-forget
    for (const userId of attendees) {
      try {
        await this.achievementsService.emitEvent({
          userId,
          eventType: 'activity.attended',
          payload: {
            activity_id: activityId,
            activity_type:
              activity.activity_types?.code ?? activity.activity_type_id,
            club_id: activity.club_sections?.main_club_id ?? null,
          },
        });
      } catch (error) {
        this.logger.warn(
          `Failed to emit achievement event: ${(error as Error).message}`,
        );
      }
    }

    return updated;
  }

  async getAttendance(activityId: number) {
    const activity = await this.prisma.activities.findUnique({
      where: { activity_id: activityId },
      select: { activity_id: true, name: true, attendees: true },
    });

    if (!activity) {
      throw new AppNotFoundException(ErrorCode.ACTIVITY_NOT_FOUND);
    }

    const attendeeIds = (activity.attendees as string[]) || [];

    if (attendeeIds.length === 0) {
      return { activity_id: activityId, attendees: [] };
    }

    const attendees = await this.prisma.users.findMany({
      where: {
        user_id: { in: attendeeIds },
      },
      select: {
        user_id: true,
        name: true,
        paternal_last_name: true,
        maternal_last_name: true,
        user_image: true,
      },
    });

    const signedAttendees = await Promise.all(
      attendees.map(async (attendee) => ({
        ...attendee,
        user_image:
          typeof attendee.user_image === 'string'
            ? await this.resolvePrivateAssetUrl(
                StorageBucketAlias.USER_PROFILES,
                attendee.user_image,
              )
            : attendee.user_image,
      })),
    );

    return {
      activity_id: activityId,
      activity_name: activity.name,
      total_attendees: signedAttendees.length,
      attendees: signedAttendees,
    };
  }

  private attachInstances(activity: any) {
    const instances = (activity.activity_instances ?? [])
      .map((instance: any) => {
        if (instance.club_sections) {
          return {
            section_id: instance.club_sections.club_section_id,
            club_id: instance.club_sections.main_club_id,
            club_type_name: instance.club_sections.club_types?.name ?? null,
          };
        }

        return null;
      })
      .filter((instance: any) => Boolean(instance));

    const { activity_instances: _ignored, ...rest } = activity;

    return {
      ...rest,
      instances,
    };
  }

  private async applySignedPrivateUrls(activity: any) {
    const [signedActivityImage, signedUserImage] = await Promise.all([
      typeof activity?.image === 'string'
        ? this.resolvePrivateAssetUrl(
            StorageBucketAlias.ACTIVITIES_IMAGES,
            activity.image,
          )
        : Promise.resolve(activity?.image),
      typeof activity?.users?.user_image === 'string'
        ? this.resolvePrivateAssetUrl(
            StorageBucketAlias.USER_PROFILES,
            activity.users.user_image,
          )
        : Promise.resolve(activity?.users?.user_image),
    ]);

    return {
      ...activity,
      image: signedActivityImage,
      users: activity?.users
        ? {
            ...activity.users,
            user_image: signedUserImage,
          }
        : activity?.users,
    };
  }

  private async resolvePrivateAssetUrl(
    bucketAlias: StorageBucketAlias,
    value: string | null | undefined,
  ): Promise<string | null> {
    if (!value) return null;

    return this.fileStorage.getSignedDownloadUrl(bucketAlias, value, {
      expiresInSeconds: ActivitiesService.PRIVATE_ASSET_URL_TTL_SECONDS,
    });
  }

  async uploadImage(activityId: number, file: Express.Multer.File) {
    // Validate mime type
    const allowedMimeTypes = ['image/jpeg', 'image/png', 'image/webp'];
    if (!allowedMimeTypes.includes(file.mimetype)) {
      throw new AppBadRequestException(ErrorCode.ACTIVITY_IMAGE_INVALID_FORMAT);
    }

    // Validate size (max 5MB)
    const maxSize = 5 * 1024 * 1024;
    if (file.size > maxSize) {
      throw new AppBadRequestException(ErrorCode.ACTIVITY_IMAGE_TOO_LARGE, {
        max_mb: '5',
      });
    }

    const activity = await this.prisma.activities.findUnique({
      where: { activity_id: activityId },
      select: { activity_id: true, image: true },
    });

    if (!activity) {
      throw new AppNotFoundException(ErrorCode.ACTIVITY_NOT_FOUND);
    }

    const extension = file.mimetype.split('/')[1];
    const fileName = `activities/${activityId}/image-${Date.now()}.${extension}`;

    let uploaded: { key: string; url: string };

    try {
      uploaded = await this.fileStorage.upload(
        StorageBucketAlias.ACTIVITIES_IMAGES,
        fileName,
        file.buffer,
        { contentType: file.mimetype, overwrite: true },
      );
    } catch (error) {
      this.logger.error('R2 upload error:', error);
      throw new AppInternalServerErrorException(
        ErrorCode.ACTIVITY_IMAGE_UPLOAD_FAILED,
      );
    }

    try {
      await this.prisma.activities.update({
        where: { activity_id: activityId },
        data: { image: uploaded.url, modified_at: new Date() },
      });
    } catch (error) {
      this.logger.error('Database update failed after upload:', error);
      await this.fileStorage.deleteMany(StorageBucketAlias.ACTIVITIES_IMAGES, [
        uploaded.key,
      ]);
      throw new AppInternalServerErrorException(
        ErrorCode.ACTIVITY_IMAGE_UPDATE_FAILED,
      );
    }

    // Delete previous image if it existed and is different
    if (
      activity.image &&
      typeof activity.image === 'string' &&
      activity.image !== uploaded.url
    ) {
      const oldKey = this.fileStorage.extractKeyFromPublicUrl(
        StorageBucketAlias.ACTIVITIES_IMAGES,
        activity.image,
      );
      if (oldKey && oldKey !== uploaded.key) {
        await this.fileStorage
          .deleteMany(StorageBucketAlias.ACTIVITIES_IMAGES, [oldKey])
          .catch((err) =>
            this.logger.warn('Failed to delete old activity image:', err),
          );
      }
    }

    this.logger.log(`Activity image uploaded for activity: ${activityId}`);

    const signedUrl = await this.resolvePrivateAssetUrl(
      StorageBucketAlias.ACTIVITIES_IMAGES,
      uploaded.url,
    );

    return {
      status: 'success',
      data: { url: signedUrl },
      message: 'Imagen de actividad actualizada exitosamente',
    };
  }

  /**
   * Validates a single section belongs to the given club and returns the full record.
   */
  private async resolveAndValidateSectionRecord(
    clubId: number,
    clubSectionId: number,
  ): Promise<{
    club_section_id: number;
    main_club_id: number;
    club_type_id: number;
  }> {
    const clubExists = await this.prisma.clubs.findUnique({
      where: { club_id: clubId },
      select: { club_id: true },
    });

    if (!clubExists) {
      throw new AppNotFoundException(ErrorCode.ACTIVITY_CLUB_NOT_FOUND);
    }

    const section = await this.prisma.club_sections.findUnique({
      where: { club_section_id: clubSectionId },
      select: { club_section_id: true, main_club_id: true, club_type_id: true },
    });

    if (!section) {
      throw new AppBadRequestException(ErrorCode.ACTIVITY_SECTION_NOT_FOUND);
    }

    if (section.main_club_id !== clubId) {
      throw new AppBadRequestException(ErrorCode.ACTIVITY_SECTION_WRONG_CLUB);
    }

    return section as {
      club_section_id: number;
      main_club_id: number;
      club_type_id: number;
    };
  }

  /**
   * Validates that all provided section IDs belong to the same club and returns their records.
   * Used for joint activities where multiple sections participate.
   */
  private async resolveAndValidateMultipleSections(
    clubId: number,
    sectionIds: number[],
  ): Promise<
    Array<{
      club_section_id: number;
      main_club_id: number;
      club_type_id: number;
    }>
  > {
    const clubExists = await this.prisma.clubs.findUnique({
      where: { club_id: clubId },
      select: { club_id: true },
    });

    if (!clubExists) {
      throw new AppNotFoundException(ErrorCode.ACTIVITY_CLUB_NOT_FOUND);
    }

    const sections = await this.prisma.club_sections.findMany({
      where: { club_section_id: { in: sectionIds } },
      select: { club_section_id: true, main_club_id: true, club_type_id: true },
    });

    // Verify all requested sections were found
    if (sections.length !== sectionIds.length) {
      const foundIds = new Set(sections.map((s) => s.club_section_id));
      const missing = sectionIds.filter((id) => !foundIds.has(id));
      throw new AppBadRequestException(ErrorCode.ACTIVITY_SECTION_NOT_FOUND);
    }

    // Verify all sections belong to the given club
    const wrongSections = sections.filter((s) => s.main_club_id !== clubId);
    if (wrongSections.length > 0) {
      const wrongIds = wrongSections.map((s) => s.club_section_id).join(', ');
      throw new AppBadRequestException(ErrorCode.ACTIVITY_SECTION_WRONG_CLUB);
    }

    // Preserve the original order from the request
    const sectionMap = new Map(sections.map((s) => [s.club_section_id, s]));
    return sectionIds.map((id) => sectionMap.get(id)!) as Array<{
      club_section_id: number;
      main_club_id: number;
      club_type_id: number;
    }>;
  }
}
