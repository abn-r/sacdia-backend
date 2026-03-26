import {
  Inject,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
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

@Injectable()
export class ActivitiesService {
  private static readonly PRIVATE_ASSET_URL_TTL_SECONDS = 300;
  private readonly logger = new Logger(ActivitiesService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(FILE_STORAGE_SERVICE)
    private readonly fileStorage: FileStorageService,
    private readonly notificationsService: NotificationsService,
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
      throw new NotFoundException(`Club with ID ${clubId} not found`);
    }

    const sectionIds = club.club_sections
      .filter(
        (section) => !filters?.clubTypeId || section.club_type_id === filters.clubTypeId,
      )
      .map((section) => section.club_section_id);

    if (sectionIds.length === 0) {
      return createPaginatedResult([], 0, pagination ?? new PaginationDto());
    }

    const where: Prisma.activitiesWhereInput = {
      activity_instances: {
        some: {
          active: true,
          club_section_id: { in: sectionIds },
        },
      },
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
      throw new NotFoundException(`Activity with ID ${activityId} not found`);
    }

    return this.applySignedPrivateUrls(this.attachInstances(activity));
  }

  async create(clubId: number, dto: CreateActivityDto, createdBy: string) {
    const sectionId = await this.resolveAndValidateSection(clubId, dto.club_section_id);

    const created = await this.prisma.activities.create({
      data: {
        name: dto.name,
        description: dto.description,
        club_type_id: dto.club_type_id,
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
        club_section_id: sectionId,
        active: true,
        created_at: new Date(),
        modified_at: new Date(),
        activity_instances: {
          create: [
            {
              club_section_id: sectionId,
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
    const dateLabel = created.activity_date
      ? ` - ${created.activity_date.toLocaleDateString('es-MX', { day: '2-digit', month: 'long', year: 'numeric' })}`
      : '';
    this.notificationsService
      .sendToClubMembers(
        sectionId,
        {
          title: 'Nueva actividad programada',
          body: `${created.name}${dateLabel}`,
          data: {
            type: 'activity',
            entity_id: String(created.activity_id),
            action: 'created',
          },
        },
        'system',
        'activities:created',
      )
      .catch((err: Error) =>
        this.logger.warn(
          `Failed to send activity-created notification (activity=${created.activity_id}): ${err.message}`,
        ),
      );

    return this.applySignedPrivateUrls(this.attachInstances(created));
  }

  async update(activityId: number, dto: UpdateActivityDto) {
    await this.findOne(activityId);

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

    return this.applySignedPrivateUrls(this.attachInstances(updated));
  }

  async remove(activityId: number) {
    await this.findOne(activityId);

    return this.prisma.activities.update({
      where: { activity_id: activityId },
      data: {
        active: false,
        modified_at: new Date(),
      },
    });
  }

  // ========================================
  // ASISTENCIA
  // ========================================

  async recordAttendance(activityId: number, dto: RecordAttendanceDto) {
    await this.findOne(activityId);

    const attendees = dto.user_ids;

    return this.prisma.activities.update({
      where: { activity_id: activityId },
      data: {
        attendees: attendees as Prisma.InputJsonValue,
        modified_at: new Date(),
      },
    });
  }

  async getAttendance(activityId: number) {
    const activity = await this.findOne(activityId);

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
    const signedActivityImage =
      typeof activity?.image === 'string'
        ? await this.resolvePrivateAssetUrl(
            StorageBucketAlias.ACTIVITIES_IMAGES,
            activity.image,
          )
        : activity?.image;

    const signedUserImage =
      typeof activity?.users?.user_image === 'string'
        ? await this.resolvePrivateAssetUrl(
            StorageBucketAlias.USER_PROFILES,
            activity.users.user_image,
          )
        : activity?.users?.user_image;

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
      throw new BadRequestException(
        'Formato no válido. Solo se permiten JPG, PNG, WEBP',
      );
    }

    // Validate size (max 5MB)
    const maxSize = 5 * 1024 * 1024;
    if (file.size > maxSize) {
      throw new BadRequestException('Archivo muy grande. Tamaño máximo: 5MB');
    }

    const activity = await this.prisma.activities.findUnique({
      where: { activity_id: activityId },
      select: { activity_id: true, image: true },
    });

    if (!activity) {
      throw new NotFoundException(`Activity with ID ${activityId} not found`);
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
      throw new InternalServerErrorException('Error al subir la imagen');
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
      throw new InternalServerErrorException('Error al actualizar la imagen');
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

  private async resolveAndValidateSection(
    clubId: number,
    clubSectionId: number,
  ): Promise<number> {
    const clubExists = await this.prisma.clubs.findUnique({
      where: { club_id: clubId },
      select: { club_id: true },
    });

    if (!clubExists) {
      throw new NotFoundException(`Club with ID ${clubId} not found`);
    }

    const section = await this.prisma.club_sections.findUnique({
      where: { club_section_id: clubSectionId },
      select: { main_club_id: true, club_type_id: true },
    });

    if (!section) {
      throw new BadRequestException(
        `Sección ${clubSectionId} no existe`,
      );
    }

    if (section.main_club_id !== clubId) {
      throw new BadRequestException(
        `Sección ${clubSectionId} no pertenece al clubId=${clubId}`,
      );
    }

    return clubSectionId;
  }
}
