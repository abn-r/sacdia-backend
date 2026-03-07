import {
  Inject,
  Injectable,
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
  ActivityInstanceSelectionDto,
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

type ActivityInstanceType = 'adventurers' | 'pathfinders' | 'master_guilds';

type NormalizedActivityInstance = {
  instance_type: ActivityInstanceType;
  instance_id: number;
  club_type_id: number;
  club_adv_id: number | null;
  club_pathf_id: number | null;
  club_mg_id: number | null;
};

@Injectable()
export class ActivitiesService {
  private static readonly PRIVATE_ASSET_URL_TTL_SECONDS = 300;

  constructor(
    private readonly prisma: PrismaService,
    @Inject(FILE_STORAGE_SERVICE)
    private readonly fileStorage: FileStorageService,
  ) {}

  private readonly activityInclude = {
    activity_types: {
      select: { activity_type_id: true, code: true, name: true },
    },
    club_types: { select: { name: true } },
    users: {
      select: { name: true, paternal_last_name: true, user_image: true },
    },
    club_adv_i: { select: { club_adv_id: true, main_club_id: true } },
    club_pathf: { select: { club_pathf_id: true, main_club_id: true } },
    club_mg: { select: { club_mg_id: true, main_club_id: true } },
    activity_instances: {
      where: { active: true },
      orderBy: { activity_instance_id: 'asc' },
      select: {
        activity_instance_id: true,
        club_adv_id: true,
        club_pathf_id: true,
        club_mg_id: true,
        club_adventurers: {
          select: {
            club_adv_id: true,
            main_club_id: true,
            club_types: { select: { name: true } },
          },
        },
        club_pathfinders: {
          select: {
            club_pathf_id: true,
            main_club_id: true,
            club_types: { select: { name: true } },
          },
        },
        club_master_guilds: {
          select: {
            club_mg_id: true,
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
        club_adventurers: { select: { club_adv_id: true, club_type_id: true } },
        club_pathfinders: {
          select: { club_pathf_id: true, club_type_id: true },
        },
        club_master_guild: { select: { club_mg_id: true, club_type_id: true } },
      },
    });

    if (!club) {
      throw new NotFoundException(`Club with ID ${clubId} not found`);
    }

    const instanceConditions = this.buildInstanceConditions(
      club,
      filters?.clubTypeId,
    );

    if (instanceConditions.length === 0) {
      return createPaginatedResult([], 0, pagination ?? new PaginationDto());
    }

    const where: Prisma.activitiesWhereInput = {
      activity_instances: {
        some: {
          active: true,
          OR: instanceConditions,
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
    const normalizedInstances = await this.resolveAndValidateInstances(
      clubId,
      dto,
    );
    const primaryInstance = this.selectPrimaryInstance(
      normalizedInstances,
      dto.club_type_id,
    );

    const created = await this.prisma.activities.create({
      data: {
        name: dto.name,
        description: dto.description,
        club_type_id: dto.club_type_id,
        lat: dto.lat,
        long: dto.long,
        activity_time: dto.activity_time || '09:00',
        activity_place: dto.activity_place,
        image: dto.image,
        platform: dto.platform || 0,
        activity_type_id: dto.activity_type_id,
        link_meet: dto.link_meet,
        additional_data: dto.additional_data,
        classes: dto.classes
          ? (dto.classes as Prisma.InputJsonValue)
          : Prisma.JsonNull,
        created_by: createdBy,
        ...primaryInstance,
        active: true,
        created_at: new Date(),
        modified_at: new Date(),
        activity_instances: {
          create: normalizedInstances.map((instance) => ({
            club_adv_id: instance.club_adv_id,
            club_pathf_id: instance.club_pathf_id,
            club_mg_id: instance.club_mg_id,
            active: true,
            created_at: new Date(),
            modified_at: new Date(),
          })),
        },
      },
      include: this.activityInclude,
    });

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
    if (dto.activity_time !== undefined)
      updateData.activity_time = dto.activity_time;
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

  private buildInstanceConditions(
    club: {
      club_adventurers: Array<{ club_adv_id: number; club_type_id: number }>;
      club_pathfinders: Array<{ club_pathf_id: number; club_type_id: number }>;
      club_master_guild: Array<{ club_mg_id: number; club_type_id: number }>;
    },
    clubTypeId?: number,
  ): Prisma.activity_instancesWhereInput[] {
    const advIds = club.club_adventurers
      .filter((instance) => !clubTypeId || instance.club_type_id === clubTypeId)
      .map((instance) => instance.club_adv_id);
    const pathfIds = club.club_pathfinders
      .filter((instance) => !clubTypeId || instance.club_type_id === clubTypeId)
      .map((instance) => instance.club_pathf_id);
    const mgIds = club.club_master_guild
      .filter((instance) => !clubTypeId || instance.club_type_id === clubTypeId)
      .map((instance) => instance.club_mg_id);

    const conditions: Prisma.activity_instancesWhereInput[] = [];

    if (advIds.length > 0) {
      conditions.push({ club_adv_id: { in: advIds } });
    }
    if (pathfIds.length > 0) {
      conditions.push({ club_pathf_id: { in: pathfIds } });
    }
    if (mgIds.length > 0) {
      conditions.push({ club_mg_id: { in: mgIds } });
    }

    return conditions;
  }

  private attachInstances(activity: any) {
    const instances = (activity.activity_instances ?? [])
      .map((instance: any) => {
        if (instance.club_adventurers) {
          return {
            instance_type: 'adventurers' as const,
            instance_id: instance.club_adventurers.club_adv_id,
            club_id: instance.club_adventurers.main_club_id,
            club_type_name: instance.club_adventurers.club_types?.name ?? null,
          };
        }

        if (instance.club_pathfinders) {
          return {
            instance_type: 'pathfinders' as const,
            instance_id: instance.club_pathfinders.club_pathf_id,
            club_id: instance.club_pathfinders.main_club_id,
            club_type_name: instance.club_pathfinders.club_types?.name ?? null,
          };
        }

        if (instance.club_master_guilds) {
          return {
            instance_type: 'master_guilds' as const,
            instance_id: instance.club_master_guilds.club_mg_id,
            club_id: instance.club_master_guilds.main_club_id,
            club_type_name:
              instance.club_master_guilds.club_types?.name ?? null,
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

  private async resolveAndValidateInstances(
    clubId: number,
    dto: CreateActivityDto,
  ): Promise<NormalizedActivityInstance[]> {
    const clubExists = await this.prisma.clubs.findUnique({
      where: { club_id: clubId },
      select: { club_id: true },
    });

    if (!clubExists) {
      throw new NotFoundException(`Club with ID ${clubId} not found`);
    }

    const selections = this.extractInstanceSelections(dto);
    const normalized: NormalizedActivityInstance[] = [];

    for (const selection of selections) {
      if (selection.instance_type === 'adventurers') {
        const instance = await this.prisma.club_adventurers.findUnique({
          where: { club_adv_id: selection.instance_id },
          select: { main_club_id: true, club_type_id: true },
        });

        if (!instance) {
          throw new BadRequestException(
            `Instancia adventurers ${selection.instance_id} no existe`,
          );
        }

        if (instance.main_club_id !== clubId) {
          throw new BadRequestException(
            `Instancia adventurers ${selection.instance_id} no pertenece al clubId=${clubId}`,
          );
        }

        normalized.push({
          instance_type: 'adventurers',
          instance_id: selection.instance_id,
          club_type_id: instance.club_type_id,
          club_adv_id: selection.instance_id,
          club_pathf_id: null,
          club_mg_id: null,
        });
        continue;
      }

      if (selection.instance_type === 'pathfinders') {
        const instance = await this.prisma.club_pathfinders.findUnique({
          where: { club_pathf_id: selection.instance_id },
          select: { main_club_id: true, club_type_id: true },
        });

        if (!instance) {
          throw new BadRequestException(
            `Instancia pathfinders ${selection.instance_id} no existe`,
          );
        }

        if (instance.main_club_id !== clubId) {
          throw new BadRequestException(
            `Instancia pathfinders ${selection.instance_id} no pertenece al clubId=${clubId}`,
          );
        }

        normalized.push({
          instance_type: 'pathfinders',
          instance_id: selection.instance_id,
          club_type_id: instance.club_type_id,
          club_adv_id: null,
          club_pathf_id: selection.instance_id,
          club_mg_id: null,
        });
        continue;
      }

      const instance = await this.prisma.club_master_guilds.findUnique({
        where: { club_mg_id: selection.instance_id },
        select: { main_club_id: true, club_type_id: true },
      });

      if (!instance) {
        throw new BadRequestException(
          `Instancia master_guilds ${selection.instance_id} no existe`,
        );
      }

      if (instance.main_club_id !== clubId) {
        throw new BadRequestException(
          `Instancia master_guilds ${selection.instance_id} no pertenece al clubId=${clubId}`,
        );
      }

      normalized.push({
        instance_type: 'master_guilds',
        instance_id: selection.instance_id,
        club_type_id: instance.club_type_id,
        club_adv_id: null,
        club_pathf_id: null,
        club_mg_id: selection.instance_id,
      });
    }

    const uniqueByKey = new Map<string, NormalizedActivityInstance>();
    for (const instance of normalized) {
      const key = `${instance.instance_type}:${instance.instance_id}`;
      uniqueByKey.set(key, instance);
    }
    const unique = Array.from(uniqueByKey.values());

    if (
      !unique.some((instance) => instance.club_type_id === dto.club_type_id)
    ) {
      throw new BadRequestException(
        `club_type_id=${dto.club_type_id} debe corresponder al menos a una de las instancias seleccionadas`,
      );
    }

    return unique;
  }

  private selectPrimaryInstance(
    instances: NormalizedActivityInstance[],
    clubTypeId: number,
  ) {
    const primary = instances.find(
      (instance) => instance.club_type_id === clubTypeId,
    );

    if (!primary) {
      throw new BadRequestException(
        `No se encontró instancia primaria para club_type_id=${clubTypeId}`,
      );
    }

    return {
      club_adv_id: primary.club_adv_id,
      club_pathf_id: primary.club_pathf_id,
      club_mg_id: primary.club_mg_id,
    };
  }

  private extractInstanceSelections(
    dto: CreateActivityDto,
  ): ActivityInstanceSelectionDto[] {
    const legacySelections: ActivityInstanceSelectionDto[] = [];

    if (dto.club_adv_id !== undefined && dto.club_adv_id !== null) {
      legacySelections.push({
        instance_type: 'adventurers',
        instance_id: dto.club_adv_id,
      });
    }

    if (dto.club_pathf_id !== undefined && dto.club_pathf_id !== null) {
      legacySelections.push({
        instance_type: 'pathfinders',
        instance_id: dto.club_pathf_id,
      });
    }

    if (dto.club_mg_id !== undefined && dto.club_mg_id !== null) {
      legacySelections.push({
        instance_type: 'master_guilds',
        instance_id: dto.club_mg_id,
      });
    }

    const explicitSelections = dto.instances ?? [];

    if (explicitSelections.length > 0 && legacySelections.length > 0) {
      throw new BadRequestException(
        'No combines instances[] con club_adv_id/club_pathf_id/club_mg_id en el mismo payload',
      );
    }

    const selections =
      explicitSelections.length > 0 ? explicitSelections : legacySelections;

    if (selections.length === 0) {
      throw new BadRequestException(
        'Debes enviar al menos una instancia en instances[] (o legacy fields durante transición)',
      );
    }

    return selections;
  }
}
