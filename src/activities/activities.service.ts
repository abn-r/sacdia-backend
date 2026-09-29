import { Inject, Injectable, Logger } from '@nestjs/common';
import 'multer';
import {
  AppBadRequestException,
  AppForbiddenException,
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
  CreateActivitySeriesDto,
  ExtendActivitySeriesDto,
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
import {
  ACTIVITY_SERIES_MAX_OCCURRENCES,
  addDuration,
  calendarDateInTimeZone,
  durationDays,
  expandActivitySeriesDates,
  isoDateFromDb,
  toUtcDate,
} from './activity-series-dates';
import {
  ACTIVITY_BOARD_ROLE_NAMES,
  activityVisibleToViewer,
  classIdsFromJson,
  parseActivityAudience,
  type ActivityAudience,
} from './activity-audience';

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
    viewerUserId?: string | null,
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
      ...(filters?.seriesId !== undefined && {
        activity_series_id: filters.seriesId,
      }),
    };

    if (userSectionId != null && viewerUserId) {
      const viewer = await this.resolveActivityViewer(
        viewerUserId,
        userSectionId,
      );
      const audienceFilter = this.audienceWhere(viewer);
      if (audienceFilter) {
        where.AND = [audienceFilter];
      }
    }

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
    const withAudience = await this.attachAudienceClasses(signedActivities);

    return createPaginatedResult(
      withAudience,
      total,
      pagination ?? new PaginationDto(),
    );
  }

  async findOne(
    activityId: number,
    viewer?: { userId: string; sectionId: number } | null,
  ) {
    const activity = await this.prisma.activities.findUnique({
      where: { activity_id: activityId },
      include: this.activityInclude,
    });

    if (!activity) {
      throw new AppNotFoundException(ErrorCode.ACTIVITY_NOT_FOUND);
    }

    if (viewer) {
      const access = await this.resolveActivityViewer(
        viewer.userId,
        viewer.sectionId,
      );
      if (!activityVisibleToViewer(activity, access)) {
        throw new AppNotFoundException(ErrorCode.ACTIVITY_NOT_FOUND);
      }
    }

    return this.presentActivity(activity);
  }

  private async presentActivity(activity: any) {
    const signed = await this.applySignedPrivateUrls(
      this.attachInstances(activity),
    );
    const [withAudience] = await this.attachAudienceClasses([signed]);
    return withAudience;
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
    const audience = await this.resolveActivityAudience(
      dto.audience,
      dto.classes,
      [section.club_section_id],
    );

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
        audience: audience.audience,
        classes: audience.classes,
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

    return this.presentActivity(created);
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
    const audience = await this.resolveActivityAudience(
      dto.audience,
      dto.classes,
      sections.map((row) => row.club_section_id),
    );

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
        audience: audience.audience,
        classes: audience.classes,
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

    return this.presentActivity(created);
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
      ? 'Actividad conjunta confirmada'
      : 'Nueva actividad para tu club';
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

    const result = await this.presentActivity(updated);
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

    return this.presentActivity(updated);
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

    return this.presentActivity(updated);
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
    const previous = stringIdList(activity.attendees);

    if (activity.platform === 1 && attendees.length > 0) {
      await this.assertUsersAreSectionMembers(
        this.sectionIdsFromActivity(activity),
        attendees,
      );
    }

    const updated = await this.prisma.activities.update({
      where: { activity_id: activityId },
      data: {
        attendees: attendees,
        modified_at: new Date(),
      },
    });

    const alreadyConfirmed = new Set(previous);
    for (const userId of attendees) {
      if (alreadyConfirmed.has(userId)) continue;
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

  async getMyRsvp(activityId: number, userId: string) {
    const activity = await this.loadRsvpActivity(activityId);
    this.assertVirtualActivity(activity.platform);
    const eligible = await this.isActiveSectionMember(
      userId,
      this.sectionIdsFromActivity(activity),
    );
    const status = parseRsvpMap(activity.rsvp)[userId] ?? null;
    return {
      activity_id: activityId,
      status: eligible ? status : null,
      eligible,
    };
  }

  async setRsvp(
    activityId: number,
    userId: string,
    status: 'going' | 'not_going',
  ) {
    const activity = await this.loadRsvpActivity(activityId);
    this.assertVirtualActivity(activity.platform);
    const member = await this.isActiveSectionMember(
      userId,
      this.sectionIdsFromActivity(activity),
    );
    if (!member) {
      throw new AppForbiddenException(ErrorCode.ACTIVITY_RSVP_NOT_MEMBER);
    }

    await this.prisma.$executeRawUnsafe(
      `UPDATE activities
       SET rsvp = COALESCE(rsvp, '{}'::jsonb) || jsonb_build_object($1::text, $2::text),
           modified_at = NOW()
       WHERE activity_id = $3::int`,
      userId,
      status,
      activityId,
    );

    return { activity_id: activityId, status };
  }

  async getAttendanceRoster(activityId: number) {
    const activity = await this.loadRsvpActivity(activityId);
    this.assertVirtualActivity(activity.platform);
    const sectionIds = this.sectionIdsFromActivity(activity);
    const yearId = await this.currentEcclesiasticalYearId();
    if (!yearId || sectionIds.length === 0) {
      return { activity_id: activityId, members: [] };
    }

    const assignments = await this.prisma.club_role_assignments.findMany({
      where: {
        club_section_id: { in: sectionIds },
        active: true,
        status: 'active',
        ecclesiastical_year_id: yearId,
      },
      select: {
        user_id: true,
        users: {
          select: {
            user_id: true,
            name: true,
            paternal_last_name: true,
            maternal_last_name: true,
            user_image: true,
          },
        },
      },
      orderBy: { start_date: 'desc' },
    });

    const confirmed = new Set(stringIdList(activity.attendees));
    const intentions = parseRsvpMap(activity.rsvp);
    const byUser = new Map<
      string,
      {
        user_id: string;
        name: string;
        user_image: string | null;
        rsvp: 'going' | 'not_going' | null;
        confirmed: boolean;
      }
    >();

    for (const assignment of assignments) {
      if (byUser.has(assignment.user_id)) continue;
      const user = assignment.users;
      byUser.set(assignment.user_id, {
        user_id: assignment.user_id,
        name: personName(user),
        user_image: user.user_image,
        rsvp: intentions[assignment.user_id] ?? null,
        confirmed: confirmed.has(assignment.user_id),
      });
    }

    const members = [...byUser.values()].sort((left, right) => {
      const byIntention = rsvpRank(left.rsvp) - rsvpRank(right.rsvp);
      if (byIntention !== 0) return byIntention;
      return left.name.localeCompare(right.name, 'es');
    });

    const signedMembers = await Promise.all(
      members.map(async (member) => ({
        ...member,
        user_image:
          typeof member.user_image === 'string'
            ? await this.resolvePrivateAssetUrl(
                StorageBucketAlias.USER_PROFILES,
                member.user_image,
              )
            : member.user_image,
      })),
    );

    return { activity_id: activityId, members: signedMembers };
  }

  private assertVirtualActivity(platform: number) {
    if (platform !== 1) {
      throw new AppBadRequestException(ErrorCode.ACTIVITY_RSVP_NOT_VIRTUAL);
    }
  }

  private async loadRsvpActivity(activityId: number) {
    const activity = await this.prisma.activities.findUnique({
      where: { activity_id: activityId },
      select: {
        activity_id: true,
        platform: true,
        club_section_id: true,
        attendees: true,
        rsvp: true,
        activity_instances: {
          where: { active: true },
          select: { club_section_id: true },
        },
      },
    });
    if (!activity) {
      throw new AppNotFoundException(ErrorCode.ACTIVITY_NOT_FOUND);
    }
    return activity;
  }

  private sectionIdsFromActivity(activity: {
    club_section_id?: number | null;
    activity_instances?: { club_section_id: number | null }[];
    instances?: { section_id?: number | null }[];
  }): number[] {
    const ids = new Set<number>();
    if (activity.club_section_id) ids.add(activity.club_section_id);
    for (const row of activity.activity_instances ?? []) {
      if (row.club_section_id) ids.add(row.club_section_id);
    }
    for (const row of activity.instances ?? []) {
      if (row.section_id) ids.add(row.section_id);
    }
    return [...ids];
  }

  private async currentEcclesiasticalYearId(): Promise<number | null> {
    const today = calendarDateInTimeZone(new Date());
    const year = await this.prisma.ecclesiastical_years.findFirst({
      where: {
        start_date: { lte: toUtcDate(today) },
        end_date: { gte: toUtcDate(today) },
      },
      select: { year_id: true },
    });
    return year?.year_id ?? null;
  }

  private audienceWhere(viewer: {
    isBoard: boolean;
    classId: number | null;
  }): Prisma.activitiesWhereInput | null {
    if (viewer.isBoard) return null;
    const or: Prisma.activitiesWhereInput[] = [{ audience: 'all' }];
    if (viewer.classId != null) {
      or.push({
        audience: 'classes',
        classes: { array_contains: [viewer.classId] },
      });
    }
    return { OR: or };
  }

  private async resolveActivityViewer(userId: string, sectionId: number) {
    const yearId = await this.currentEcclesiasticalYearId();
    if (!yearId) return { isBoard: false, classId: null as number | null };

    const section = await this.prisma.club_sections.findUnique({
      where: { club_section_id: sectionId },
      select: { club_type_id: true },
    });
    const [board, enrollment] = await Promise.all([
      this.prisma.club_role_assignments.findFirst({
        where: {
          user_id: userId,
          club_section_id: sectionId,
          active: true,
          status: 'active',
          ecclesiastical_year_id: yearId,
          roles: { role_name: { in: [...ACTIVITY_BOARD_ROLE_NAMES] } },
        },
        select: { assignment_id: true },
      }),
      section
        ? this.prisma.enrollments.findFirst({
            where: {
              user_id: userId,
              active: true,
              record_kind: 'OPERATIONAL',
              ecclesiastical_year_id: yearId,
              classes: { club_type_id: section.club_type_id },
            },
            select: { class_id: true },
            orderBy: { enrollment_date: 'desc' },
          })
        : Promise.resolve(null),
    ]);

    return {
      isBoard: Boolean(board),
      classId: enrollment?.class_id ?? null,
    };
  }

  private async resolveActivityAudience(
    audience: string | undefined,
    classIds: number[] | undefined,
    sectionIds: number[],
  ): Promise<{
    audience: ActivityAudience;
    classes: Prisma.InputJsonValue | typeof Prisma.JsonNull;
  }> {
    const scope = parseActivityAudience(audience);
    if (
      audience !== undefined &&
      audience !== 'all' &&
      audience !== 'board' &&
      audience !== 'classes'
    ) {
      throw new AppBadRequestException(ErrorCode.ACTIVITY_AUDIENCE_INVALID);
    }
    if (scope !== 'classes') {
      return { audience: scope, classes: Prisma.JsonNull };
    }

    const ids = [
      ...new Set((classIds ?? []).filter((id) => Number.isInteger(id))),
    ];
    if (ids.length === 0) {
      throw new AppBadRequestException(
        ErrorCode.ACTIVITY_AUDIENCE_CLASSES_REQUIRED,
      );
    }

    const sections = await this.prisma.club_sections.findMany({
      where: { club_section_id: { in: sectionIds } },
      select: { club_type_id: true },
    });
    const clubTypeIds = [...new Set(sections.map((row) => row.club_type_id))];
    const found = await this.prisma.classes.findMany({
      where: {
        class_id: { in: ids },
        active: true,
        club_type_id: { in: clubTypeIds },
      },
      select: { class_id: true },
    });
    if (found.length !== ids.length) {
      throw new AppBadRequestException(ErrorCode.ACTIVITY_AUDIENCE_CLASS_INVALID);
    }

    return { audience: 'classes', classes: ids };
  }

  private async isActiveSectionMember(
    userId: string,
    sectionIds: number[],
  ): Promise<boolean> {
    if (sectionIds.length === 0) return false;
    const yearId = await this.currentEcclesiasticalYearId();
    if (!yearId) return false;
    const assignment = await this.prisma.club_role_assignments.findFirst({
      where: {
        user_id: userId,
        club_section_id: { in: sectionIds },
        active: true,
        status: 'active',
        ecclesiastical_year_id: yearId,
      },
      select: { assignment_id: true },
    });
    return Boolean(assignment);
  }

  private async assertUsersAreSectionMembers(
    sectionIds: number[],
    userIds: string[],
  ) {
    const yearId = await this.currentEcclesiasticalYearId();
    if (!yearId || sectionIds.length === 0) {
      throw new AppBadRequestException(
        ErrorCode.ACTIVITY_ATTENDANCE_OUTSIDE_SECTION,
      );
    }
    const rows = await this.prisma.club_role_assignments.findMany({
      where: {
        user_id: { in: userIds },
        club_section_id: { in: sectionIds },
        active: true,
        status: 'active',
        ecclesiastical_year_id: yearId,
      },
      select: { user_id: true },
    });
    const found = new Set(rows.map((row) => row.user_id));
    if (userIds.some((id) => !found.has(id))) {
      throw new AppBadRequestException(
        ErrorCode.ACTIVITY_ATTENDANCE_OUTSIDE_SECTION,
      );
    }
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

  private async attachAudienceClasses<
    T extends { audience?: string | null; classes?: unknown },
  >(
    activities: T[],
  ): Promise<
    Array<
      T & {
        audience: ActivityAudience;
        audience_classes: Array<{
          class_id: number;
          name: string;
          asset_code: string | null;
          club_type_id: number;
        }>;
      }
    >
  > {
    const ids = new Set<number>();
    for (const activity of activities) {
      if (parseActivityAudience(activity.audience) !== 'classes') continue;
      for (const id of classIdsFromJson(activity.classes)) ids.add(id);
    }

    const found =
      ids.size === 0
        ? []
        : await this.prisma.classes.findMany({
            where: { class_id: { in: [...ids] } },
            select: {
              class_id: true,
              name: true,
              asset_code: true,
              club_type_id: true,
            },
          });
    const byId = new Map(found.map((row) => [row.class_id, row]));

    return activities.map((activity) => {
      const audience = parseActivityAudience(activity.audience);
      const audienceClasses =
        audience === 'classes'
          ? classIdsFromJson(activity.classes)
              .map((id) => byId.get(id))
              .filter((row): row is NonNullable<typeof row> => row != null)
          : [];
      return { ...activity, audience, audience_classes: audienceClasses };
    });
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

    try {
      return await this.fileStorage.getSignedDownloadUrl(bucketAlias, value, {
        expiresInSeconds: ActivitiesService.PRIVATE_ASSET_URL_TTL_SECONDS,
      });
    } catch (error) {
      this.logger.warn(
        `Failed to generate signed URL for ${bucketAlias}. Returning original value.`,
        error,
      );
      return value;
    }
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

  async previewActivitySeries(
    clubId: number,
    dto: CreateActivitySeriesDto,
    now = new Date(),
  ) {
    const plan = await this.planActivitySeries(clubId, dto, now);
    return {
      count: plan.dates.length,
      dates: plan.dates,
      until: plan.until,
      ecclesiastical_year: {
        year_id: plan.year.year_id,
        start_date: isoDateFromDb(plan.year.start_date),
        end_date: isoDateFromDb(plan.year.end_date),
      },
    };
  }

  async createActivitySeries(
    clubId: number,
    dto: CreateActivitySeriesDto,
    createdBy: string,
    now = new Date(),
  ) {
    const plan = await this.planActivitySeries(clubId, dto, now);
    const audience = await this.resolveActivityAudience(
      dto.audience,
      dto.classes,
      plan.sectionIds,
    );
    const createdAt = now;

    const result = await this.prisma.$transaction(
      async (tx) => {
        const series = await tx.activity_series.create({
          data: {
            club_id: clubId,
            ecclesiastical_year_id: plan.year.year_id,
            created_by: createdBy,
            name: dto.name,
            description: dto.description,
            club_type_id: plan.clubTypeId,
            club_section_id: plan.ownerSectionId,
            is_joint: plan.isJoint,
            lat: dto.lat,
            long: dto.long,
            activity_time: dto.activity_time || '09:00',
            duration_days: plan.durationDays,
            activity_place: dto.activity_place,
            image: dto.image ?? '',
            platform: dto.platform || 0,
            activity_type_id: dto.activity_type_id,
            link_meet: dto.link_meet,
            additional_data: dto.additional_data,
            audience: audience.audience,
            classes: audience.classes,
            first_date: toUtcDate(plan.dates[0]),
            kind: dto.recurrence.kind,
            interval_days:
              dto.recurrence.kind === 'interval'
                ? dto.recurrence.interval_days
                : null,
            weekdays:
              dto.recurrence.kind === 'weekly' ? dto.recurrence.weekdays : [],
            until_date: toUtcDate(plan.until),
            active: true,
            created_at: createdAt,
            modified_at: createdAt,
          },
        });

        await tx.activity_series_sections.createMany({
          data: plan.sectionIds.map((club_section_id) => ({
            activity_series_id: series.activity_series_id,
            club_section_id,
          })),
        });

        const activityIds = await this.insertSeriesOccurrences(tx, {
          dates: plan.dates,
          durationDays: plan.durationDays,
          sectionIds: plan.sectionIds,
          seriesId: series.activity_series_id,
          createdBy,
          createdAt,
          name: dto.name,
          description: dto.description,
          clubTypeId: plan.clubTypeId,
          lat: dto.lat,
          long: dto.long,
          activityTime: dto.activity_time || '09:00',
          activityPlace: dto.activity_place,
          image: dto.image ?? '',
          platform: dto.platform || 0,
          activityTypeId: dto.activity_type_id,
          linkMeet: dto.link_meet,
          additionalData: dto.additional_data,
          audience: audience.audience,
          classes: audience.classes,
          ownerSectionId: plan.ownerSectionId,
          isJoint: plan.isJoint,
        });

        return { series, activityIds };
      },
      { timeout: 30_000, maxWait: 10_000 },
    );

    for (const sectionId of plan.sectionIds) {
      this.sendSeriesCreatedNotification(
        dto.name,
        result.activityIds.length,
        sectionId,
        plan.isJoint,
        result.series.activity_series_id,
      );
      this.emitRealtimeInvalidation(
        sectionId,
        result.series.activity_series_id,
        'CREATED',
        createdBy,
      );
    }

    return {
      series: this.serializeSeries(result.series),
      created_count: result.activityIds.length,
      activity_ids: result.activityIds,
    };
  }

  async findActivitySeries(seriesId: number, now = new Date()) {
    const series = await this.prisma.activity_series.findUnique({
      where: { activity_series_id: seriesId },
      include: {
        activity_series_sections: {
          select: { club_section_id: true },
        },
      },
    });

    if (!series) {
      throw new AppNotFoundException(ErrorCode.ACTIVITY_SERIES_NOT_FOUND);
    }

    const today = calendarDateInTimeZone(now);
    const activities = await this.prisma.activities.findMany({
      where: { activity_series_id: seriesId },
      select: { activity_id: true, active: true, activity_date: true },
    });

    const total = activities.length;
    const active = activities.filter((row) => row.active).length;
    const upcoming = activities.filter((row) => {
      if (!row.active || !row.activity_date) return false;
      return isoDateFromDb(row.activity_date) >= today;
    }).length;
    const past = activities.filter((row) => {
      if (!row.activity_date) return false;
      return isoDateFromDb(row.activity_date) < today;
    }).length;

    return {
      ...this.serializeSeries(series),
      club_section_ids: series.activity_series_sections.map(
        (row) => row.club_section_id,
      ),
      counts: { total, active, upcoming, past },
    };
  }

  async cancelFutureActivitySeries(
    seriesId: number,
    actorId?: string,
    now = new Date(),
  ) {
    const series = await this.requireActivitySeries(seriesId);
    const today = toUtcDate(calendarDateInTimeZone(now));

    const result = await this.prisma.activities.updateMany({
      where: {
        activity_series_id: seriesId,
        active: true,
        activity_date: { gte: today },
      },
      data: { active: false, modified_at: now },
    });

    for (const sectionId of await this.seriesSectionIds(series)) {
      this.emitRealtimeInvalidation(
        sectionId,
        series.activity_series_id,
        'UPDATED',
        actorId,
      );
    }

    return { canceled_count: result.count };
  }

  async extendActivitySeries(
    seriesId: number,
    dto: ExtendActivitySeriesDto,
    createdBy: string,
    now = new Date(),
  ) {
    const series = await this.requireActivitySeries(seriesId);
    const newUntil = dto.until.slice(0, 10);
    const currentUntil = isoDateFromDb(series.until_date);
    if (newUntil < currentUntil) {
      throw new AppBadRequestException(
        ErrorCode.ACTIVITY_SERIES_EXTEND_UNTIL_REGRESSION,
      );
    }

    const year = await this.prisma.ecclesiastical_years.findUnique({
      where: { year_id: series.ecclesiastical_year_id },
      select: { year_id: true, start_date: true, end_date: true },
    });
    if (!year) {
      throw new AppBadRequestException(
        ErrorCode.ACTIVITY_SERIES_OUTSIDE_ECCLESIASTICAL_YEAR,
      );
    }
    const yearEnd = isoDateFromDb(year.end_date);
    if (newUntil > yearEnd) {
      throw new AppBadRequestException(
        ErrorCode.ACTIVITY_SERIES_OUTSIDE_ECCLESIASTICAL_YEAR,
      );
    }

    const firstDate = isoDateFromDb(series.first_date);
    const allDates = this.assertSeriesSize(
      expandActivitySeriesDates({
        start: firstDate,
        until: newUntil,
        rule: {
          kind: series.kind as 'interval' | 'weekly',
          intervalDays: series.interval_days,
          weekdays: series.weekdays,
        },
      }),
    );

    const existing = await this.prisma.activities.findMany({
      where: { activity_series_id: seriesId },
      select: { activity_date: true },
    });
    const existingDates = new Set(
      existing
        .map((row) => row.activity_date)
        .filter((value): value is Date => Boolean(value))
        .map((value) => isoDateFromDb(value)),
    );
    const datesToCreate = allDates.filter((date) => !existingDates.has(date));
    const sectionIds = await this.seriesSectionIds(series);
    const createdAt = now;

    const activityIds = await this.prisma.$transaction(
      async (tx) => {
        const ids = await this.insertSeriesOccurrences(tx, {
          dates: datesToCreate,
          durationDays: series.duration_days,
          sectionIds,
          seriesId: series.activity_series_id,
          createdBy,
          createdAt,
          name: series.name,
          description: series.description,
          clubTypeId: series.club_type_id,
          lat: series.lat,
          long: series.long,
          activityTime: series.activity_time,
          activityPlace: series.activity_place,
          image: series.image,
          platform: series.platform,
          activityTypeId: series.activity_type_id,
          linkMeet: series.link_meet,
          additionalData: series.additional_data,
          audience: parseActivityAudience(series.audience),
          classes:
            (series.classes as Prisma.InputJsonValue) ?? Prisma.JsonNull,
          ownerSectionId: series.club_section_id,
          isJoint: series.is_joint,
        });

        await tx.activity_series.update({
          where: { activity_series_id: seriesId },
          data: { until_date: toUtcDate(newUntil), modified_at: createdAt },
        });

        return ids;
      },
      { timeout: 30_000, maxWait: 10_000 },
    );

    if (activityIds.length > 0) {
      for (const sectionId of sectionIds) {
        this.sendSeriesCreatedNotification(
          series.name,
          activityIds.length,
          sectionId,
          series.is_joint,
          series.activity_series_id,
        );
        this.emitRealtimeInvalidation(
          sectionId,
          series.activity_series_id,
          'CREATED',
          createdBy,
        );
      }
    }

    return { created_count: activityIds.length, activity_ids: activityIds };
  }

  private async planActivitySeries(
    clubId: number,
    dto: CreateActivitySeriesDto,
    now: Date,
  ) {
    if (!dto.activity_date) {
      throw new AppBadRequestException(ErrorCode.ACTIVITY_SERIES_INVALID_RULE);
    }

    const start = dto.activity_date.slice(0, 10);
    const today = calendarDateInTimeZone(now);
    if (start < today) {
      throw new AppBadRequestException(ErrorCode.ACTIVITY_SERIES_DATE_IN_PAST);
    }

    const rule = this.normalizeRecurrence(dto.recurrence);
    const year = await this.prisma.ecclesiastical_years.findFirst({
      where: {
        start_date: { lte: toUtcDate(today) },
        end_date: { gte: toUtcDate(today) },
      },
      select: { year_id: true, start_date: true, end_date: true },
    });
    if (!year) {
      throw new AppBadRequestException(
        ErrorCode.ACTIVITY_SERIES_OUTSIDE_ECCLESIASTICAL_YEAR,
      );
    }

    const yearStart = isoDateFromDb(year.start_date);
    const yearEnd = isoDateFromDb(year.end_date);
    if (start < yearStart || start > yearEnd) {
      throw new AppBadRequestException(
        ErrorCode.ACTIVITY_SERIES_OUTSIDE_ECCLESIASTICAL_YEAR,
      );
    }

    const until = (dto.recurrence.until ?? yearEnd).slice(0, 10);
    if (until < start) {
      throw new AppBadRequestException(
        ErrorCode.ACTIVITY_SERIES_UNTIL_BEFORE_START,
      );
    }
    if (until > yearEnd || until < yearStart) {
      throw new AppBadRequestException(
        ErrorCode.ACTIVITY_SERIES_OUTSIDE_ECCLESIASTICAL_YEAR,
      );
    }

    const dates = this.assertSeriesSize(
      expandActivitySeriesDates({ start, until, rule }),
    );
    if (dates.length === 0) {
      throw new AppBadRequestException(ErrorCode.ACTIVITY_SERIES_EMPTY);
    }

    const duration = durationDays(start, dto.activity_end_date?.slice(0, 10));
    const isJoint = Boolean(
      dto.club_section_ids && dto.club_section_ids.length >= 2,
    );

    if (isJoint) {
      const rawSectionIds = dto.club_section_ids!;
      const uniqueSectionIds = [...new Set(rawSectionIds)];
      if (uniqueSectionIds.length !== rawSectionIds.length) {
        throw new AppBadRequestException(
          ErrorCode.ACTIVITY_SECTION_DUPLICATE_IDS,
        );
      }
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
      const owner =
        (dto.club_section_id
          ? sections.find((row) => row.club_section_id === dto.club_section_id)
          : sections[0]) ?? sections[0];
      if (dto.club_type_id && dto.club_type_id !== owner.club_type_id) {
        throw new AppBadRequestException(
          ErrorCode.ACTIVITY_SECTION_CLUB_TYPE_MISMATCH,
        );
      }
      return {
        dates,
        until,
        year,
        durationDays: duration,
        isJoint: true,
        ownerSectionId: owner.club_section_id,
        clubTypeId: dto.club_type_id ?? owner.club_type_id,
        sectionIds: sections.map((row) => row.club_section_id),
      };
    }

    if (!dto.club_section_id) {
      throw new AppBadRequestException(ErrorCode.ACTIVITY_SECTION_ID_REQUIRED);
    }
    const section = await this.resolveAndValidateSectionRecord(
      clubId,
      dto.club_section_id,
    );
    return {
      dates,
      until,
      year,
      durationDays: duration,
      isJoint: false,
      ownerSectionId: section.club_section_id,
      clubTypeId: dto.club_type_id ?? section.club_type_id,
      sectionIds: [section.club_section_id],
    };
  }

  private normalizeRecurrence(recurrence: CreateActivitySeriesDto['recurrence']) {
    if (recurrence.kind === 'interval') {
      const intervalDays = recurrence.interval_days;
      if (
        !intervalDays ||
        (recurrence.weekdays && recurrence.weekdays.length > 0)
      ) {
        throw new AppBadRequestException(ErrorCode.ACTIVITY_SERIES_INVALID_RULE);
      }
      return { kind: 'interval' as const, intervalDays };
    }

    const weekdays = recurrence.weekdays ?? [];
    if (weekdays.length !== 1 || recurrence.interval_days != null) {
      throw new AppBadRequestException(ErrorCode.ACTIVITY_SERIES_INVALID_RULE);
    }
    return { kind: 'weekly' as const, weekdays };
  }

  private assertSeriesSize(dates: string[]): string[] {
    if (dates.length > ACTIVITY_SERIES_MAX_OCCURRENCES) {
      throw new AppBadRequestException(ErrorCode.ACTIVITY_SERIES_TOO_MANY);
    }
    return dates;
  }

  private async insertSeriesOccurrences(
    tx: Prisma.TransactionClient,
    params: {
      dates: string[];
      durationDays: number;
      sectionIds: number[];
      seriesId: number;
      createdBy: string;
      createdAt: Date;
      name: string;
      description?: string | null;
      clubTypeId: number;
      lat: number;
      long: number;
      activityTime: string;
      activityPlace: string;
      image: string;
      platform: number;
      activityTypeId: number;
      linkMeet?: string | null;
      additionalData?: string | null;
      audience: ActivityAudience;
      classes: Prisma.InputJsonValue | typeof Prisma.JsonNull;
      ownerSectionId: number | null;
      isJoint: boolean;
    },
  ): Promise<number[]> {
    if (params.dates.length === 0) {
      return [];
    }

    const created = await tx.activities.createManyAndReturn({
      data: params.dates.map((date) => ({
        name: params.name,
        description: params.description,
        club_type_id: params.clubTypeId,
        lat: params.lat,
        long: params.long,
        activity_time: params.activityTime,
        activity_date: toUtcDate(date),
        activity_end_date: toUtcDate(addDuration(date, params.durationDays)),
        activity_place: params.activityPlace,
        image: params.image,
        platform: params.platform,
        activity_type_id: params.activityTypeId,
        link_meet: params.linkMeet,
        additional_data: params.additionalData,
        audience: params.audience,
        classes: params.classes,
        created_by: params.createdBy,
        club_section_id: params.ownerSectionId,
        is_joint: params.isJoint,
        active: true,
        activity_series_id: params.seriesId,
        created_at: params.createdAt,
        modified_at: params.createdAt,
      })),
      select: { activity_id: true },
    });

    await tx.activity_instances.createMany({
      data: created.flatMap((row) =>
        params.sectionIds.map((club_section_id) => ({
          activity_id: row.activity_id,
          club_section_id,
          active: true,
          created_at: params.createdAt,
          modified_at: params.createdAt,
        })),
      ),
    });

    return created.map((row) => row.activity_id);
  }

  private async requireActivitySeries(seriesId: number) {
    const series = await this.prisma.activity_series.findUnique({
      where: { activity_series_id: seriesId },
      include: {
        activity_series_sections: { select: { club_section_id: true } },
      },
    });
    if (!series) {
      throw new AppNotFoundException(ErrorCode.ACTIVITY_SERIES_NOT_FOUND);
    }
    return series;
  }

  private async seriesSectionIds(series: {
    club_section_id: number | null;
    activity_series_sections?: Array<{ club_section_id: number }>;
  }): Promise<number[]> {
    const fromJoin =
      series.activity_series_sections?.map((row) => row.club_section_id) ?? [];
    if (fromJoin.length > 0) {
      return fromJoin;
    }
    return series.club_section_id ? [series.club_section_id] : [];
  }

  private serializeSeries(series: {
    activity_series_id: number;
    club_id: number;
    ecclesiastical_year_id: number;
    name: string;
    description: string | null;
    club_type_id: number;
    club_section_id: number | null;
    is_joint: boolean;
    activity_time: string;
    duration_days: number;
    activity_place: string;
    platform: number;
    activity_type_id: number;
    first_date: Date;
    kind: string;
    interval_days: number | null;
    weekdays: number[];
    until_date: Date;
    active: boolean;
  }) {
    return {
      activity_series_id: series.activity_series_id,
      club_id: series.club_id,
      ecclesiastical_year_id: series.ecclesiastical_year_id,
      name: series.name,
      description: series.description,
      club_type_id: series.club_type_id,
      club_section_id: series.club_section_id,
      is_joint: series.is_joint,
      activity_time: series.activity_time,
      duration_days: series.duration_days,
      activity_place: series.activity_place,
      platform: series.platform,
      activity_type_id: series.activity_type_id,
      first_date: isoDateFromDb(series.first_date),
      kind: series.kind,
      interval_days: series.interval_days,
      weekdays: series.weekdays,
      until_date: isoDateFromDb(series.until_date),
      active: series.active,
    };
  }

  private sendSeriesCreatedNotification(
    name: string,
    count: number,
    sectionId: number,
    isJoint: boolean,
    seriesId: number,
  ): void {
    const title = isJoint
      ? 'Serie conjunta programada'
      : 'Serie de actividades programada';
    this.notificationsService
      .sendToClubMembers(
        sectionId,
        {
          title,
          body: `${count} sesiones: ${name}`,
          data: {
            type: 'activity_series',
            entity_id: String(seriesId),
            action: 'created',
          },
        },
        'system',
        'activities:created',
      )
      .catch((err: Error) =>
        this.logger.warn(
          `Failed to send series-created notification (series=${seriesId}, section=${sectionId}): ${err.message}`,
        ),
      );
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

function stringIdList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === 'string');
}

function parseRsvpMap(value: unknown): Record<string, 'going' | 'not_going'> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const parsed: Record<string, 'going' | 'not_going'> = {};
  for (const [userId, status] of Object.entries(
    value as Record<string, unknown>,
  )) {
    if (status === 'going' || status === 'not_going') {
      parsed[userId] = status;
    }
  }
  return parsed;
}

function personName(user: {
  name: string | null;
  paternal_last_name: string | null;
  maternal_last_name: string | null;
}): string {
  return [user.name, user.paternal_last_name, user.maternal_last_name]
    .filter((part) => typeof part === 'string' && part.trim().length > 0)
    .join(' ');
}

function rsvpRank(status: 'going' | 'not_going' | null): number {
  if (status === 'going') return 0;
  if (status == null) return 1;
  return 2;
}
