import {
  Inject,
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Prisma } from '@prisma/client';
import {
  CreateClubDto,
  UpdateClubDto,
  CreateClubSectionDto,
  UpdateClubSectionDto,
  AssignRoleDto,
  UpdateRoleAssignmentDto,
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
import { AuthorizationContextService } from '../common/services/authorization-context.service';
import { NotificationsService } from '../notifications/notifications.service';

@Injectable()
export class ClubsService {
  private readonly logger = new Logger(ClubsService.name);
  private static readonly PRIVATE_ASSET_URL_TTL_SECONDS = 300;

  constructor(
    private readonly prisma: PrismaService,
    @Inject(FILE_STORAGE_SERVICE)
    private readonly fileStorage: FileStorageService,
    private readonly authorizationContext: AuthorizationContextService,
    private readonly notificationsService: NotificationsService,
  ) {}

  // ========================================
  // CLUBS - CRUD
  // ========================================

  async findAll(
    filters?: {
      localFieldId?: number;
      districtId?: number;
      churchId?: number;
      active?: boolean;
    },
    pagination?: PaginationDto,
  ): Promise<PaginatedResult<any>> {
    const where = {
      ...(filters?.localFieldId && { local_field_id: filters.localFieldId }),
      ...(filters?.districtId && {
        districlub_type_id: filters.districtId,
      }),
      ...(filters?.churchId && { church_id: filters.churchId }),
      ...(filters?.active !== undefined && { active: filters.active }),
    };

    const [data, total] = await Promise.all([
      this.prisma.clubs.findMany({
        where,
        include: {
          churches: { select: { name: true } },
          districts: { select: { name: true } },
          local_fields: { select: { name: true } },
          club_sections: {
            select: {
              club_section_id: true,
              active: true,
              club_types: { select: { name: true } },
            },
          },
        },
        orderBy: { name: 'asc' },
        skip: pagination?.skip ?? 0,
        take: pagination?.take ?? 20,
      }),
      this.prisma.clubs.count({ where }),
    ]);

    return createPaginatedResult(
      data,
      total,
      pagination ?? new PaginationDto(),
    );
  }

  async findOne(clubId: number) {
    const club = await this.prisma.clubs.findUnique({
      where: { club_id: clubId },
      include: {
        churches: true,
        districts: true,
        local_fields: true,
        club_sections: {
          include: { club_types: { select: { name: true } } },
        },
      },
    });

    if (!club) {
      throw new NotFoundException(`Club with ID ${clubId} not found`);
    }

    return club;
  }

  async create(dto: CreateClubDto) {
    return this.prisma.clubs.create({
      data: {
        name: dto.name,
        description: dto.description,
        local_field_id: dto.local_field_id,
        districlub_type_id: dto.districlub_type_id,
        church_id: dto.church_id,
        address: dto.address,
        coordinates: dto.coordinates || { lat: 0, lng: 0 },
        active: true,
      },
    });
  }

  async update(clubId: number, dto: UpdateClubDto) {
    await this.findOne(clubId); // Verify exists

    return this.prisma.clubs.update({
      where: { club_id: clubId },
      data: {
        ...dto,
        modified_at: new Date(),
      },
    });
  }

  async remove(clubId: number) {
    await this.findOne(clubId);

    return this.prisma.clubs.update({
      where: { club_id: clubId },
      data: { active: false, modified_at: new Date() },
    });
  }

  // ========================================
  // SECTIONS (unified club_sections)
  // ========================================

  async getSections(clubId: number) {
    await this.findOne(clubId);
    // Intentionally limited select: this endpoint is called without
    // club_sections:read permission to support the post-registration flow.
    // Only expose fields needed to identify and select a section — operational
    // details (fee, souls_target, meeting_day/time, contact info) are omitted.
    return this.prisma.club_sections.findMany({
      where: { main_club_id: clubId },
      select: {
        club_section_id: true,
        active: true,
        name: true,
        club_types: { select: { club_type_id: true, name: true } },
      },
      orderBy: { club_section_id: 'asc' },
    });
  }

  async getSection(sectionId: number) {
    const section = await this.prisma.club_sections.findUnique({
      where: { club_section_id: sectionId },
      include: { club_types: { select: { name: true } } },
    });
    if (!section)
      throw new NotFoundException(`Club section ${sectionId} not found`);
    return section;
  }

  async createSection(clubId: number, dto: CreateClubSectionDto) {
    await this.findOne(clubId);
    const clubType = await this.prisma.club_types.findUnique({
      where: { club_type_id: dto.club_type_id },
    });
    if (!clubType || !clubType.active) {
      throw new BadRequestException(
        `Club type ${dto.club_type_id} not found or inactive`,
      );
    }
    return this.prisma.club_sections.create({
      data: {
        main_club_id: clubId,
        club_type_id: dto.club_type_id,
        souls_target: dto.souls_target || 1,
        fee: dto.fee || 0,
        meeting_day: (dto.meeting_day || []) as Prisma.InputJsonValue[],
        meeting_time: (dto.meeting_time || []) as Prisma.InputJsonValue[],
        active: true,
      },
      include: { club_types: { select: { name: true } } },
    });
  }

  async updateSection(sectionId: number, dto: UpdateClubSectionDto) {
    const { meeting_day, meeting_time, ...rest } = dto;
    return this.prisma.club_sections.update({
      where: { club_section_id: sectionId },
      data: {
        ...rest,
        ...(meeting_day !== undefined && {
          meeting_day: meeting_day as Prisma.InputJsonValue[],
        }),
        ...(meeting_time !== undefined && {
          meeting_time: meeting_time as Prisma.InputJsonValue[],
        }),
        modified_at: new Date(),
      },
      include: { club_types: { select: { name: true } } },
    });
  }

  // ========================================
  // ROLE ASSIGNMENTS
  // ========================================

  async getMembers(sectionId: number) {
    const members = await this.prisma.club_role_assignments.findMany({
      where: {
        club_section_id: sectionId,
        active: true,
      },
      include: {
        users: {
          select: {
            user_id: true,
            name: true,
            paternal_last_name: true,
            maternal_last_name: true,
            user_image: true,
          },
        },
        roles: {
          select: {
            role_id: true,
            role_name: true,
            role_category: true,
          },
        },
      },
      orderBy: { start_date: 'desc' },
    });

    return Promise.all(
      members.map(async (member) => ({
        ...member,
        users: member.users
          ? {
              ...member.users,
              user_image:
                typeof member.users.user_image === 'string'
                  ? await this.resolvePrivateProfileUrl(member.users.user_image)
                  : member.users.user_image,
            }
          : member.users,
      })),
    );
  }

  async assignRole(dto: AssignRoleDto) {
    if (!dto.club_section_id) {
      throw new BadRequestException('club_section_id is required');
    }

    const roleId = await this.resolveRoleId(dto);
    const ecclesiasticalYearId =
      dto.ecclesiastical_year_id ??
      (await this.getActiveEcclesiasticalYearId());
    const startDate = dto.start_date ?? new Date();

    await this.validateRoleSlot(dto.club_section_id, roleId);

    const assignment = {
      user_id: dto.user_id,
      role_id: roleId,
      ecclesiastical_year_id: ecclesiasticalYearId,
      start_date: startDate,
      end_date: dto.end_date,
      active: true,
      status: 'active',
      club_section_id: dto.club_section_id,
    };

    const created = await this.prisma.club_role_assignments.create({
      data: assignment,
      include: {
        users: { select: { name: true, paternal_last_name: true } },
        roles: { select: { role_name: true } },
      },
    });

    await this.authorizationContext.invalidateUserAuthorizationCache(
      dto.user_id,
    );

    this.emitRealtimeInvalidation(dto.club_section_id, created.assignment_id, 'CREATED', dto.user_id);

    return created;
  }

  async updateRoleAssignment(
    assignmentId: string,
    dto: UpdateRoleAssignmentDto,
  ) {
    const updateData: Record<string, unknown> = {
      modified_at: new Date(),
    };

    if (dto.role_id || dto.role) {
      updateData.role_id = await this.resolveRoleId(dto);
    }

    if (dto.ecclesiastical_year_id !== undefined) {
      updateData.ecclesiastical_year_id = dto.ecclesiastical_year_id;
    }

    if (dto.start_date !== undefined) {
      updateData.start_date = dto.start_date;
    }

    if (dto.end_date !== undefined) {
      updateData.end_date = dto.end_date;
    }

    if (dto.status !== undefined) {
      updateData.status = dto.status;
    }

    const updated = await this.prisma.club_role_assignments.update({
      where: { assignment_id: assignmentId },
      data: updateData,
      select: {
        assignment_id: true,
        user_id: true,
        club_section_id: true,
      },
    });

    await this.authorizationContext.invalidateUserAuthorizationCache(
      updated.user_id,
    );

    this.emitRealtimeInvalidation(updated.club_section_id, updated.assignment_id, 'UPDATED');

    return updated;
  }

  async removeRoleAssignment(assignmentId: string) {
    const removed = await this.prisma.club_role_assignments.update({
      where: { assignment_id: assignmentId },
      data: {
        active: false,
        status: 'ended',
        end_date: new Date(),
        modified_at: new Date(),
      },
      select: {
        assignment_id: true,
        user_id: true,
        club_section_id: true,
      },
    });

    await this.authorizationContext.invalidateUserAuthorizationCache(
      removed.user_id,
    );

    this.emitRealtimeInvalidation(removed.club_section_id, removed.assignment_id, 'DELETED');

    return removed;
  }

  // ========================================
  // HELPERS
  // ========================================

  private async validateRoleSlot(
    sectionId: number,
    roleId: string,
  ): Promise<void> {
    // 1. Check max_per_section from role_slot_limits
    const slotLimit = await this.prisma.role_slot_limits.findUnique({
      where: { role_id: roleId },
    });

    if (slotLimit?.max_per_section != null) {
      const currentCount = await this.prisma.club_role_assignments.count({
        where: {
          club_section_id: sectionId,
          role_id: roleId,
          active: true,
        },
      });

      if (currentCount >= slotLimit.max_per_section) {
        const role = await this.prisma.roles.findUnique({
          where: { role_id: roleId },
          select: { role_name: true },
        });
        throw new ConflictException(
          `Maximum ${slotLimit.max_per_section} "${role?.role_name ?? roleId}" per section reached`,
        );
      }
    }

    // 2. Mutual exclusivity: secretary / treasurer vs secretary-treasurer
    const role = await this.prisma.roles.findUnique({
      where: { role_id: roleId },
      select: { role_name: true },
    });

    if (!role) return;

    const roleName = role.role_name.toLowerCase();

    if (roleName === 'secretary' || roleName === 'treasurer') {
      const secTreasRole = await this.prisma.roles.findFirst({
        where: { role_name: 'secretary-treasurer', active: true },
        select: { role_id: true },
      });

      if (secTreasRole) {
        const hasSecTreas = await this.prisma.club_role_assignments.findFirst({
          where: {
            club_section_id: sectionId,
            role_id: secTreasRole.role_id,
            active: true,
          },
        });

        if (hasSecTreas) {
          throw new ConflictException(
            `Cannot assign "${roleName}" when "secretary-treasurer" already exists in this section`,
          );
        }
      }
    }

    if (roleName === 'secretary-treasurer') {
      const conflictingRoles = await this.prisma.roles.findMany({
        where: { role_name: { in: ['secretary', 'treasurer'] }, active: true },
        select: { role_id: true, role_name: true },
      });

      if (conflictingRoles.length > 0) {
        const conflictingIds = conflictingRoles.map((r) => r.role_id);
        const existingConflict =
          await this.prisma.club_role_assignments.findFirst({
            where: {
              club_section_id: sectionId,
              role_id: { in: conflictingIds },
              active: true,
            },
            include: {
              roles: { select: { role_name: true } },
            },
          });

        if (existingConflict) {
          throw new ConflictException(
            `Cannot assign "secretary-treasurer" when "${existingConflict.roles.role_name}" already exists in this section`,
          );
        }
      }
    }
  }

  private async getActiveEcclesiasticalYearId(): Promise<number> {
    const currentYear = await this.prisma.ecclesiastical_years.findFirst({
      where: {
        start_date: { lte: new Date() },
        end_date: { gte: new Date() },
      },
      select: { year_id: true },
    });

    if (!currentYear) {
      throw new BadRequestException('No active ecclesiastical year configured');
    }

    return currentYear.year_id;
  }

  private async resolveRoleId(
    dto: Pick<AssignRoleDto, 'role_id' | 'role'>,
  ): Promise<string> {
    if (dto.role_id) {
      return dto.role_id;
    }

    if (!dto.role) {
      throw new BadRequestException('role_id or role is required');
    }

    const normalizedRoleName = dto.role.trim().toLowerCase();
    if (!normalizedRoleName) {
      throw new BadRequestException('role is empty');
    }

    const role = await this.prisma.roles.findFirst({
      where: {
        role_name: normalizedRoleName,
        role_category: 'CLUB',
        active: true,
      },
      select: { role_id: true },
    });

    if (!role) {
      throw new BadRequestException(
        `Role "${normalizedRoleName}" not found in CLUB category`,
      );
    }

    return role.role_id;
  }

  private async resolvePrivateProfileUrl(
    value: string | null | undefined,
  ): Promise<string | null> {
    if (!value) return null;

    try {
      return await this.fileStorage.getSignedDownloadUrl(
        StorageBucketAlias.USER_PROFILES,
        value,
        {
          expiresInSeconds: ClubsService.PRIVATE_ASSET_URL_TTL_SECONDS,
        },
      );
    } catch (error) {
      this.logger.warn(
        'Failed to generate signed URL for club member profile. Returning original value.',
        error,
      );
      return value;
    }
  }

  private emitRealtimeInvalidation(
    sectionId: number | null | undefined,
    entityId: number | string,
    action: 'CREATED' | 'UPDATED' | 'DELETED',
    actorId?: string,
  ): void {
    if (!sectionId) return;
    this.notificationsService
      .sendSilentToSection({
        sectionId,
        resource: 'members',
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
}
