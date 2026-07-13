import { Inject, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Prisma } from '@prisma/client';
import {
  CreateClubDto,
  UpdateClubDto,
  CreateClubSectionDto,
  UpdateClubSectionDto,
  AssignRoleDto,
  UpdateRoleAssignmentDto,
  DirectorInitialAssignmentDto,
  DirectorSuccessionDto,
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
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import type { ListByClubResult } from '../audit-logs/audit-logs.service';
import {
  AppBadRequestException,
  AppConflictException,
  AppForbiddenException,
  AppNotFoundException,
} from '../common/errors/app.exception';
import { ErrorCode } from '../common/errors/error-codes';

const CLASS_COUNSELOR_GUIDE_MAJOR_CLASS_FILTERS = [
  { name: { contains: 'Guía Mayor', mode: 'insensitive' as const } },
  { name: { contains: 'Guia Mayor', mode: 'insensitive' as const } },
];
const CLASS_COUNSELOR_GUIDE_MAJOR_FINISHED_STATUSES = [
  'APPROVED',
  'INVESTIDO',
] as const;
const CLASS_COUNSELOR_GUIDE_MAJOR_INELIGIBLE_ACTIVE_STATUSES = [
  'REJECTED',
  'EXPIRED',
] as const;

@Injectable()
export class ClubsService {
  private readonly logger = new Logger(ClubsService.name);
  private static readonly PRIVATE_ASSET_URL_TTL_SECONDS = 300;
  private static readonly CANONICAL_ROLE_SLOT_LIMITS_BY_NAME: Record<
    string,
    number
  > = {
    director: 1,
    'deputy-director': 2,
    secretary: 1,
    treasurer: 1,
    'secretary-treasurer': 1,
  };

  constructor(
    private readonly prisma: PrismaService,
    @Inject(FILE_STORAGE_SERVICE)
    private readonly fileStorage: FileStorageService,
    private readonly authorizationContext: AuthorizationContextService,
    private readonly notificationsService: NotificationsService,
    private readonly auditLogs: AuditLogsService,
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
      throw new AppNotFoundException(ErrorCode.CLUB_NOT_FOUND);
    }

    return club;
  }

  async create(dto: CreateClubDto) {
    const club = await this.prisma.clubs.create({
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

    void this.auditLogs
      .recordEvent({
        entity_type: 'club',
        entity_id: String(club.club_id),
        action: 'CREATED',
        club_id: club.club_id,
        summary: `Club creado: ${club.name}`,
      })
      .catch((err: unknown) =>
        this.logger.warn(`[AuditLogs] create hook error: ${String(err)}`),
      );

    return club;
  }

  async update(clubId: number, dto: UpdateClubDto) {
    const current = await this.findOne(clubId);

    const updated = await this.prisma.clubs.update({
      where: { club_id: clubId },
      data: {
        ...dto,
        modified_at: new Date(),
      },
    });

    // Build diff of changed fields (skip active=false — that's covered by remove)
    const changes: Record<string, { from: unknown; to: unknown }> = {};
    for (const key of Object.keys(dto) as (keyof UpdateClubDto)[]) {
      if (key === 'active' && dto[key] === false) continue;
      const prev = (current as Record<string, unknown>)[key];
      const next = dto[key] as unknown;
      if (prev !== next) {
        changes[key] = { from: prev, to: next };
      }
    }

    if (Object.keys(changes).length > 0) {
      void this.auditLogs
        .recordEvent({
          entity_type: 'club',
          entity_id: String(clubId),
          action: 'UPDATED',
          club_id: clubId,
          changes,
        })
        .catch((err: unknown) =>
          this.logger.warn(`[AuditLogs] update hook error: ${String(err)}`),
        );
    }

    return updated;
  }

  async remove(clubId: number) {
    await this.findOne(clubId);

    const result = await this.prisma.clubs.update({
      where: { club_id: clubId },
      data: { active: false, modified_at: new Date() },
    });

    void this.auditLogs
      .recordEvent({
        entity_type: 'club',
        entity_id: String(clubId),
        action: 'DELETED',
        club_id: clubId,
        summary: 'Club desactivado',
      })
      .catch((err: unknown) =>
        this.logger.warn(`[AuditLogs] remove hook error: ${String(err)}`),
      );

    return result;
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
      throw new AppNotFoundException(ErrorCode.CLUB_SECTION_NOT_FOUND);
    return section;
  }

  async createSection(clubId: number, dto: CreateClubSectionDto) {
    await this.findOne(clubId);
    const clubType = await this.prisma.club_types.findUnique({
      where: { club_type_id: dto.club_type_id },
    });
    if (!clubType || !clubType.active) {
      throw new AppBadRequestException(ErrorCode.CLUB_TYPE_NOT_FOUND);
    }
    const section = await this.prisma.club_sections.create({
      data: {
        main_club_id: clubId,
        club_type_id: dto.club_type_id,
        name: dto.name,
        souls_target: dto.souls_target ?? 1,
        fee: dto.fee ?? 0,
        meeting_day: (dto.meeting_day || []) as Prisma.InputJsonValue[],
        meeting_time: (dto.meeting_time || []) as Prisma.InputJsonValue[],
        active: true,
      },
      include: { club_types: { select: { name: true } } },
    });

    void this.auditLogs
      .recordEvent({
        entity_type: 'club_section',
        entity_id: String(section.club_section_id),
        action: 'CREATED',
        club_id: clubId,
        summary: `Sección creada: ${section.club_types?.name ?? String(dto.club_type_id)}`,
      })
      .catch((err: unknown) =>
        this.logger.warn(
          `[AuditLogs] createSection hook error: ${String(err)}`,
        ),
      );

    return section;
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
    const now = new Date();
    const [section, activeYear] = await Promise.all([
      this.prisma.club_sections.findUnique({
        where: { club_section_id: sectionId },
        select: { club_type_id: true },
      }),
      this.prisma.ecclesiastical_years.findFirst({
        where: {
          start_date: { lte: now },
          end_date: { gte: now },
        },
        select: { year_id: true },
        orderBy: { start_date: 'desc' },
      }),
    ]);

    const currentEnrollmentSelect =
      activeYear?.year_id && section?.club_type_id
        ? {
            enrollments: {
              where: {
                ecclesiastical_year_id: activeYear.year_id,
                active: true,
                classes: {
                  club_type_id: section.club_type_id,
                },
              },
              orderBy: { enrollment_date: 'desc' as const },
              take: 1,
              select: {
                enrollment_id: true,
                class_id: true,
                ecclesiastical_year_id: true,
                investiture_status: true,
                classes: {
                  select: {
                    class_id: true,
                    name: true,
                    club_type_id: true,
                  },
                },
              },
            },
          }
        : {};

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
            ...currentEnrollmentSelect,
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

    const memberUserIds = [
      ...new Set(
        members
          .map((member) => member.user_id)
          .filter((userId): userId is string => Boolean(userId)),
      ),
    ];

    const guideMajorEnrollments =
      memberUserIds.length > 0
        ? await this.prisma.enrollments.findMany({
            where: {
              user_id: { in: memberUserIds },
              classes: {
                OR: CLASS_COUNSELOR_GUIDE_MAJOR_CLASS_FILTERS,
              },
              OR: [
                {
                  active: true,
                  investiture_status: {
                    notIn: [
                      ...CLASS_COUNSELOR_GUIDE_MAJOR_INELIGIBLE_ACTIVE_STATUSES,
                    ],
                  },
                },
                {
                  investiture_status: {
                    in: [...CLASS_COUNSELOR_GUIDE_MAJOR_FINISHED_STATUSES],
                  },
                },
              ],
            },
            select: {
              user_id: true,
              enrollment_id: true,
              class_id: true,
              investiture_status: true,
              active: true,
              classes: {
                select: {
                  class_id: true,
                  name: true,
                },
              },
            },
          })
        : [];
    const guideMajorEligibilityByUserId = new Map(
      guideMajorEnrollments.map((enrollment) => [
        enrollment.user_id,
        {
          enrollment_id: enrollment.enrollment_id,
          class_id: enrollment.class_id,
          name: enrollment.classes?.name ?? 'Guía Mayor',
          investiture_status: enrollment.investiture_status,
          active: enrollment.active,
        },
      ]),
    );

    return Promise.all(
      members.map(async (member) => {
        type MemberEnrollmentProjection = {
          enrollment_id: number;
          class_id: number;
          ecclesiastical_year_id: number;
          investiture_status: string;
          classes: {
            class_id: number;
            name: string;
            club_type_id: number;
          } | null;
        };

        const user = member.users as unknown as
          | (Omit<NonNullable<typeof member.users>, 'enrollments'> & {
              enrollments?: MemberEnrollmentProjection[];
            })
          | null;
        const currentEnrollment = user?.enrollments?.[0] ?? null;
        const currentClass = currentEnrollment?.classes
          ? {
              id: currentEnrollment.classes.class_id,
              class_id: currentEnrollment.classes.class_id,
              name: currentEnrollment.classes.name,
              club_type_id: currentEnrollment.classes.club_type_id,
              enrollment_id: currentEnrollment.enrollment_id,
              ecclesiastical_year_id: currentEnrollment.ecclesiastical_year_id,
              investiture_status: currentEnrollment.investiture_status,
            }
          : null;
        const guideMajorEligibility =
          guideMajorEligibilityByUserId.get(member.user_id) ?? null;
        const userFields = { ...(user ?? {}) };
        delete (userFields as { enrollments?: unknown }).enrollments;
        const resolvedUserImage =
          typeof userFields.user_image === 'string'
            ? await this.resolvePrivateProfileUrl(userFields.user_image)
            : userFields.user_image;

        return {
          ...member,
          is_enrolled: member.active,
          class_counselor_eligible: guideMajorEligibility !== null,
          guide_major_class: guideMajorEligibility,
          current_class: currentClass,
          current_class_id: currentClass?.class_id ?? null,
          current_class_name: currentClass?.name ?? null,
          enrollment_id: currentClass?.enrollment_id ?? null,
          users: member.users
            ? {
                ...userFields,
                user_image: resolvedUserImage,
                class_counselor_eligible: guideMajorEligibility !== null,
                guide_major_class: guideMajorEligibility,
                current_class: currentClass,
              }
            : member.users,
        };
      }),
    );
  }

  async assignRole(dto: AssignRoleDto) {
    if (!dto.club_section_id) {
      throw new AppBadRequestException(ErrorCode.CLUB_SECTION_ID_REQUIRED);
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

    this.emitRealtimeInvalidation(
      dto.club_section_id,
      created.assignment_id,
      'CREATED',
      dto.user_id,
    );

    // Audit: only track leadership role assignments
    const roleName = created.roles.role_name.toLowerCase();
    if (['director', 'deputy-director', 'secretary'].includes(roleName)) {
      const fullName = [created.users?.name, created.users?.paternal_last_name]
        .filter(Boolean)
        .join(' ');

      // Resolve club_id from the section
      const section = await this.prisma.club_sections.findUnique({
        where: { club_section_id: dto.club_section_id },
        select: { main_club_id: true },
      });

      void this.auditLogs
        .recordEvent({
          entity_type: 'role_assignment',
          entity_id: created.assignment_id,
          action: 'CREATED',
          club_id: section?.main_club_id ?? undefined,
          actor_user_id: dto.user_id,
          summary: `Asignado ${roleName}: ${fullName || dto.user_id}`,
        })
        .catch((err: unknown) =>
          this.logger.warn(`[AuditLogs] assignRole hook error: ${String(err)}`),
        );
    }

    return created;
  }

  async updateRoleAssignment(
    assignmentId: string,
    dto: UpdateRoleAssignmentDto,
  ) {
    const existing = await this.prisma.club_role_assignments.findUnique({
      where: { assignment_id: assignmentId },
      select: {
        assignment_id: true,
        user_id: true,
        role_id: true,
        club_section_id: true,
        active: true,
      },
    });

    if (!existing) {
      throw new AppNotFoundException(ErrorCode.GUARD_ASSIGNMENT_NOT_FOUND);
    }

    const updateData: Record<string, unknown> = {
      modified_at: new Date(),
    };

    if (dto.role_id || dto.role) {
      const targetRoleId = await this.resolveRoleId(dto);

      if (
        targetRoleId !== existing.role_id &&
        existing.active &&
        existing.club_section_id != null
      ) {
        await this.validateRoleSlot(
          existing.club_section_id,
          targetRoleId,
          existing.assignment_id,
        );
      }

      updateData.role_id = targetRoleId;
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

    this.emitRealtimeInvalidation(
      updated.club_section_id,
      updated.assignment_id,
      'UPDATED',
    );

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

    this.emitRealtimeInvalidation(
      removed.club_section_id,
      removed.assignment_id,
      'DELETED',
    );

    return removed;
  }

  async succeedSectionDirector(
    sectionId: number,
    actorUserId: string,
    dto: DirectorSuccessionDto,
  ): Promise<{
    ended_assignment_id: string;
    new_assignment_id: string;
  }> {
    await this.assertCanSucceedSectionDirector(actorUserId, sectionId);

    const directorRole = await this.prisma.roles.findFirst({
      where: {
        role_name: 'director',
        role_category: 'CLUB',
        active: true,
      },
      select: { role_id: true },
    });

    if (!directorRole) {
      throw new AppNotFoundException(ErrorCode.CLUB_ROLE_NOT_FOUND);
    }

    const startDate = dto.start_date ?? new Date();

    const result = await this.prisma.$transaction(async (tx) => {
      const current = await tx.club_role_assignments.findUnique({
        where: { assignment_id: dto.current_assignment_id },
        select: {
          assignment_id: true,
          user_id: true,
          club_section_id: true,
          role_id: true,
          active: true,
          roles: { select: { role_name: true } },
        },
      });

      if (
        !current ||
        current.club_section_id !== sectionId ||
        !current.active ||
        current.roles.role_name.toLowerCase() !== 'director'
      ) {
        throw new AppNotFoundException(ErrorCode.GUARD_ASSIGNMENT_NOT_FOUND);
      }

      const ended = await tx.club_role_assignments.update({
        where: { assignment_id: dto.current_assignment_id },
        data: {
          active: false,
          status: 'ended',
          end_date: startDate,
          modified_at: new Date(),
        },
        select: {
          assignment_id: true,
          user_id: true,
          club_section_id: true,
        },
      });

      const existingActiveDirectorCount = await tx.club_role_assignments.count({
        where: {
          club_section_id: sectionId,
          role_id: directorRole.role_id,
          active: true,
          assignment_id: { not: dto.current_assignment_id },
        },
      });

      if (existingActiveDirectorCount > 0) {
        throw new AppConflictException(ErrorCode.CLUB_ROLE_SLOT_LIMIT_REACHED);
      }

      const created = await tx.club_role_assignments.create({
        data: {
          user_id: dto.successor_user_id,
          role_id: directorRole.role_id,
          ecclesiastical_year_id: dto.ecclesiastical_year_id,
          start_date: startDate,
          active: true,
          status: 'active',
          club_section_id: sectionId,
        },
        select: {
          assignment_id: true,
          user_id: true,
          club_section_id: true,
        },
      });

      return { ended, created };
    });

    await Promise.all([
      this.authorizationContext.invalidateUserAuthorizationCache(
        result.ended.user_id,
      ),
      this.authorizationContext.invalidateUserAuthorizationCache(
        result.created.user_id,
      ),
    ]);

    this.emitRealtimeInvalidation(
      sectionId,
      result.ended.assignment_id,
      'DELETED',
      actorUserId,
    );
    this.emitRealtimeInvalidation(
      sectionId,
      result.created.assignment_id,
      'CREATED',
      actorUserId,
    );

    return {
      ended_assignment_id: result.ended.assignment_id,
      new_assignment_id: result.created.assignment_id,
    };
  }

  async assignInitialSectionDirector(
    sectionId: number,
    actorUserId: string,
    dto: DirectorInitialAssignmentDto,
  ): Promise<{ assignment_id: string }> {
    await this.assertCanSucceedSectionDirector(actorUserId, sectionId);

    const directorRole = await this.prisma.roles.findFirst({
      where: {
        role_name: 'director',
        role_category: 'CLUB',
        active: true,
      },
      select: { role_id: true },
    });

    if (!directorRole) {
      throw new AppNotFoundException(ErrorCode.CLUB_ROLE_NOT_FOUND);
    }

    const startDate = dto.start_date ?? new Date();

    const created = await this.prisma.$transaction(async (tx) => {
      const existingActiveDirectorCount = await tx.club_role_assignments.count({
        where: {
          club_section_id: sectionId,
          role_id: directorRole.role_id,
          active: true,
        },
      });

      if (existingActiveDirectorCount > 0) {
        throw new AppConflictException(ErrorCode.CLUB_ROLE_SLOT_LIMIT_REACHED);
      }

      return tx.club_role_assignments.create({
        data: {
          user_id: dto.user_id,
          role_id: directorRole.role_id,
          ecclesiastical_year_id: dto.ecclesiastical_year_id,
          start_date: startDate,
          active: true,
          status: 'active',
          club_section_id: sectionId,
        },
        select: {
          assignment_id: true,
          user_id: true,
          club_section_id: true,
        },
      });
    });

    await this.authorizationContext.invalidateUserAuthorizationCache(
      created.user_id,
    );

    this.emitRealtimeInvalidation(
      sectionId,
      created.assignment_id,
      'CREATED',
      actorUserId,
    );

    return { assignment_id: created.assignment_id };
  }

  // ========================================
  // AGGREGATIONS
  // ========================================

  /**
   * GET /clubs/:clubId/leadership
   *
   * Returns active role assignments for all sections of a club, grouped by role.
   * Filtering is by role_name (lowercase) since role_category only has GLOBAL|CLUB.
   * Director roles: 'director'
   * Deputy roles: 'deputy-director'
   * Secretary roles: 'secretary', 'secretary-treasurer'
   * Others: all remaining CLUB-category assignments
   */
  async getClubLeadership(clubId: number) {
    const assignments = await this.prisma.club_role_assignments.findMany({
      where: {
        active: true,
        club_sections: {
          main_club_id: clubId,
        },
      },
      include: {
        users: {
          select: {
            user_id: true,
            name: true,
            paternal_last_name: true,
            maternal_last_name: true,
            user_image: true,
            email: true,
          },
        },
        roles: {
          select: {
            role_name: true,
            role_category: true,
          },
        },
        club_sections: {
          select: {
            name: true,
          },
        },
      },
      orderBy: { start_date: 'asc' },
    });

    // Resolve profile image URLs in parallel
    const resolved = await Promise.all(
      assignments.map(async (a) => ({
        assignment_id: a.assignment_id,
        user_id: a.user_id,
        name: a.users?.name ?? null,
        paternal_last_name: a.users?.paternal_last_name ?? null,
        maternal_last_name: a.users?.maternal_last_name ?? null,
        user_image: await this.resolvePrivateProfileUrl(a.users?.user_image),
        email: a.users?.email ?? null,
        role_name: a.roles.role_name,
        section_name: a.club_sections?.name ?? null,
        start_date: a.start_date,
      })),
    );

    const directors = resolved.filter(
      (r) => r.role_name.toLowerCase() === 'director',
    );
    const deputies = resolved.filter(
      (r) => r.role_name.toLowerCase() === 'deputy-director',
    );
    const secretaries = resolved.filter((r) =>
      ['secretary', 'secretary-treasurer'].includes(r.role_name.toLowerCase()),
    );
    const others = resolved.filter(
      (r) =>
        ![
          'director',
          'deputy-director',
          'secretary',
          'secretary-treasurer',
        ].includes(r.role_name.toLowerCase()),
    );

    return {
      status: 'ok',
      data: {
        director: directors[0] ?? null,
        deputies,
        secretaries,
        others,
      },
    };
  }

  /**
   * GET /clubs/:clubId/overview
   *
   * Returns aggregated data for the club detail dashboard.
   *
   * --- Score formula (documented) ---
   * Components:
   *   A) attendance_avg   — avg(weekly_records.attendance) across all members,
   *                         last 52 weeks. weekly_records.attendance is an integer
   *                         (treat as 0-100 scale per weekly scoring system).
   *                         Weight: 50% when attendance data available, else 0%.
   *   B) active_sections  — (count active sections / total sections) * 100.
   *                         Weight: 30% always (adjusted to 50% if no attendance).
   *   C) capacity         — (active_members / souls_target_sum) * 100, capped at 100.
   *                         Weight: 20% always (adjusted to 50% if no attendance).
   *
   * When attendance data is unavailable:
   *   score = B*0.60 + C*0.40
   *
   * Grade thresholds: A>=90, B+>=80, B>=70, C+>=60, C>=50, D>=40, F<40
   *
   * --- Data sources ---
   * - attendance:        weekly_records joined via unit_members → units → club_sections
   * - upcoming_events:   activities.activity_date >= today, club_section.main_club_id = clubId
   * - pending_requests:  role_assignment_requests.status='pending' on sections of the club
   * - active_members:    unit_members.active=true via units → club_sections
   */
  async getClubOverview(clubId: number) {
    const now = new Date();

    // 1. Fetch all section IDs for this club (needed for multiple sub-queries)
    const sections = await this.prisma.club_sections.findMany({
      where: { main_club_id: clubId },
      select: {
        club_section_id: true,
        active: true,
        souls_target: true,
      },
    });

    const sectionIds = sections.map((s) => s.club_section_id);

    // 2. Parallel fetch: upcoming events, pending requests, active members, attendance
    const [upcomingRaw, pendingCount, activeMembersCount, weeklyRaw] =
      await Promise.all([
        // Upcoming activities for any section of this club
        sectionIds.length > 0
          ? this.prisma.activities.findMany({
              where: {
                club_section_id: { in: sectionIds },
                activity_date: { gte: now },
                active: true,
              },
              include: {
                club_sections: { select: { name: true } },
                activity_types: { select: { code: true } },
              },
              orderBy: { activity_date: 'asc' },
              take: 5,
            })
          : Promise.resolve([]),

        // Pending role assignment requests across club sections
        sectionIds.length > 0
          ? this.prisma.role_assignment_requests.count({
              where: {
                club_section_id: { in: sectionIds },
                status: 'pending',
              },
            })
          : Promise.resolve(0),

        // Active unit members across all units of club sections
        sectionIds.length > 0
          ? this.prisma.unit_members.count({
              where: {
                active: true,
                units: {
                  club_section_id: { in: sectionIds },
                },
              },
            })
          : Promise.resolve(0),

        // Weekly attendance records for members in this club (last 52 weeks)
        // Path: weekly_records → unit_members (user_id match) → units → club_sections
        // Prisma does not allow a direct filter through this path, so use raw groupBy
        // on user_ids that belong to the club.
        sectionIds.length > 0
          ? this.prisma.unit_members
              .findMany({
                where: {
                  active: true,
                  units: { club_section_id: { in: sectionIds } },
                },
                select: { user_id: true },
                distinct: ['user_id'],
              })
              .then((members) => {
                if (members.length === 0) return [];
                const userIds = members.map((m) => m.user_id);
                const oneYearAgo = new Date(now);
                oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);
                const currentWeek = this.getISOWeek(now);
                const currentYear = now.getFullYear();
                // Determine start week/year (52 weeks back)
                const startYear =
                  currentWeek <= 52 ? currentYear - 1 : currentYear;
                return this.prisma.weekly_records.findMany({
                  where: {
                    user_id: { in: userIds },
                    active: true,
                    OR: [{ year: currentYear }, { year: startYear }],
                  },
                  select: {
                    year: true,
                    week: true,
                    attendance: true,
                  },
                  orderBy: [{ year: 'asc' }, { week: 'asc' }],
                });
              })
          : Promise.resolve([]),
      ]);

    // 3. Build attendance series (group by year+week, average across members)
    let attendanceSeries: Array<{
      year: number;
      week: number;
      avg_pct: number;
    }> | null = null;
    let attendanceAverage: number | null = null;

    if (Array.isArray(weeklyRaw) && weeklyRaw.length > 0) {
      const grouped = new Map<string, number[]>();
      for (const r of weeklyRaw) {
        const key = `${r.year}-${r.week}`;
        if (!grouped.has(key)) grouped.set(key, []);
        grouped.get(key)!.push(r.attendance);
      }
      attendanceSeries = Array.from(grouped.entries()).map(([key, vals]) => {
        const [year, week] = key.split('-').map(Number);
        const avg = vals.reduce((s, v) => s + v, 0) / vals.length;
        return { year, week, avg_pct: Math.round(avg * 10) / 10 };
      });
      const allAvg =
        attendanceSeries.reduce((s, r) => s + r.avg_pct, 0) /
        attendanceSeries.length;
      attendanceAverage = Math.round(allAvg * 10) / 10;
    }

    // 4. Compute score
    const totalSections = sections.length;
    const activeSections = sections.filter((s) => s.active).length;
    const sectionsPct =
      totalSections > 0 ? (activeSections / totalSections) * 100 : 0;

    const soulsTargetSum = sections.reduce(
      (sum, s) => sum + (s.souls_target ?? 0),
      0,
    );
    const capacityPct =
      soulsTargetSum > 0
        ? Math.min((activeMembersCount / soulsTargetSum) * 100, 100)
        : 0;

    let scoreValue: number;
    let breakdown: Array<{ label: string; value_pct: number; weight: number }>;

    if (attendanceAverage !== null) {
      scoreValue =
        attendanceAverage * 0.5 + sectionsPct * 0.3 + capacityPct * 0.2;
      breakdown = [
        {
          label: 'Attendance average',
          value_pct: attendanceAverage,
          weight: 0.5,
        },
        { label: 'Active sections', value_pct: sectionsPct, weight: 0.3 },
        { label: 'Capacity filled', value_pct: capacityPct, weight: 0.2 },
      ];
    } else {
      scoreValue = sectionsPct * 0.6 + capacityPct * 0.4;
      breakdown = [
        {
          label: 'Active sections',
          value_pct: sectionsPct,
          weight: 0.6,
        },
        {
          label: 'Capacity filled',
          value_pct: capacityPct,
          weight: 0.4,
        },
      ];
    }

    scoreValue = Math.round(scoreValue * 10) / 10;

    const grade = this.computeGrade(scoreValue);

    // 5. Map upcoming events
    const upcoming_events = upcomingRaw.map((a) => ({
      activity_id: a.activity_id,
      name: a.name,
      kind: a.activity_types?.code ?? null,
      activity_date: a.activity_date?.toISOString().split('T')[0] ?? null,
      section_name: a.club_sections?.name ?? null,
    }));

    // 6. Count members with investiture_status=APPROVED in the active
    //    ecclesiastical year, scoped to this club via:
    //    unit_members → units.club_section_id → club_sections.main_club_id
    let investidos_year = 0;
    if (sectionIds.length > 0) {
      const activeYear = await this.prisma.ecclesiastical_years.findFirst({
        where: { active: true },
        select: { year_id: true },
      });

      if (activeYear) {
        // Collect user_ids that are active unit members of this club
        const clubMemberIds = await this.prisma.unit_members.findMany({
          where: {
            active: true,
            units: { club_section_id: { in: sectionIds } },
          },
          select: { user_id: true },
          distinct: ['user_id'],
        });

        if (clubMemberIds.length > 0) {
          const userIds = clubMemberIds.map((m) => m.user_id);
          investidos_year = await this.prisma.enrollments.count({
            where: {
              user_id: { in: userIds },
              ecclesiastical_year_id: activeYear.year_id,
              investiture_status: 'APPROVED',
              active: true,
            },
          });
        }
      }
    }

    return {
      status: 'ok',
      data: {
        attendance: attendanceSeries,
        attendance_average: attendanceAverage,
        score: { value: scoreValue, grade, breakdown },
        upcoming_events,
        funnel: {
          pending_requests: pendingCount,
          active_members: activeMembersCount,
          investidos_year,
        },
      },
    };
  }

  /**
   * GET /clubs/:clubId/history
   *
   * Returns paginated audit log entries for the club.
   * Supports cursor-based pagination descending by audit_log_id.
   */
  async getClubHistory(
    clubId: number,
    opts: { limit?: number; cursor?: string },
  ): Promise<ListByClubResult> {
    await this.findOne(clubId);
    const cursorBigInt =
      opts.cursor !== undefined ? BigInt(opts.cursor) : undefined;
    return this.auditLogs.listByClub(clubId, {
      limit: opts.limit,
      cursor: cursorBigInt,
    });
  }

  private computeGrade(score: number): string {
    if (score >= 90) return 'A';
    if (score >= 80) return 'B+';
    if (score >= 70) return 'B';
    if (score >= 60) return 'C+';
    if (score >= 50) return 'C';
    if (score >= 40) return 'D';
    return 'F';
  }

  /** Returns ISO week number (1-52/53) for a given date */
  private getISOWeek(date: Date): number {
    const d = new Date(
      Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()),
    );
    const dayNum = d.getUTCDay() || 7;
    d.setUTCDate(d.getUTCDate() + 4 - dayNum);
    const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
    return Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  }

  // ========================================
  // HELPERS
  // ========================================

  private async validateRoleSlot(
    sectionId: number,
    roleId: string,
    excludeAssignmentId?: string,
  ): Promise<void> {
    const role = await this.prisma.roles.findUnique({
      where: { role_id: roleId },
      select: { role_name: true },
    });

    if (!role) return;

    const roleName = role.role_name.toLowerCase();

    // 1. Check max_per_section from role_slot_limits, with canonical fallback
    // for core leadership roles. This makes the invariant effective even when
    // the seed was not applied in an environment.
    const slotLimit = await this.prisma.role_slot_limits.findUnique({
      where: { role_id: roleId },
    });
    const maxPerSection = this.getEffectiveMaxPerSection(
      roleName,
      slotLimit?.max_per_section,
    );

    if (maxPerSection != null) {
      const where: Prisma.club_role_assignmentsWhereInput = {
        club_section_id: sectionId,
        role_id: roleId,
        active: true,
        ...(excludeAssignmentId
          ? { assignment_id: { not: excludeAssignmentId } }
          : {}),
      };
      const currentCount = await this.prisma.club_role_assignments.count({
        where,
      });

      if (currentCount >= maxPerSection) {
        throw new AppConflictException(ErrorCode.CLUB_ROLE_SLOT_LIMIT_REACHED);
      }
    }

    // 2. Mutual exclusivity: secretary / treasurer vs secretary-treasurer
    if (roleName === 'secretary' || roleName === 'treasurer') {
      const secTreasRoles = await this.prisma.roles.findMany({
        where: { role_name: { in: ['secretary-treasurer'] }, active: true },
        select: { role_id: true },
      });

      if (secTreasRoles.length > 0) {
        const secTreasRoleIds = secTreasRoles.map((item) => item.role_id);
        const hasSecTreas = await this.prisma.club_role_assignments.findFirst({
          where: {
            club_section_id: sectionId,
            role_id: { in: secTreasRoleIds },
            active: true,
            ...(excludeAssignmentId
              ? { assignment_id: { not: excludeAssignmentId } }
              : {}),
          },
        });

        if (hasSecTreas) {
          throw new AppConflictException(
            ErrorCode.CLUB_ROLE_EXCLUSIVE_CONFLICT,
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
              ...(excludeAssignmentId
                ? { assignment_id: { not: excludeAssignmentId } }
                : {}),
            },
            include: {
              roles: { select: { role_name: true } },
            },
          });

        if (existingConflict) {
          throw new AppConflictException(
            ErrorCode.CLUB_ROLE_EXCLUSIVE_CONFLICT,
          );
        }
      }
    }
  }

  private async assertCanSucceedSectionDirector(
    actorUserId: string,
    sectionId: number,
  ): Promise<void> {
    const hasAllowedGlobalRole =
      await this.authorizationContext.hasAnyGlobalRole(actorUserId, [
        'super-admin',
        'admin',
        'director-lf',
        'assistant-lf',
      ]);

    if (!hasAllowedGlobalRole) {
      throw new AppForbiddenException(ErrorCode.GUARD_PERMISSION_DENIED);
    }

    const section = await this.prisma.club_sections.findUnique({
      where: { club_section_id: sectionId },
      select: { main_club_id: true },
    });

    if (!section || section.main_club_id == null) {
      throw new AppNotFoundException(ErrorCode.CLUB_SECTION_NOT_FOUND);
    }

    const canManageClub = await this.authorizationContext.canManageClub(
      actorUserId,
      section.main_club_id,
    );

    if (!canManageClub) {
      throw new AppForbiddenException(ErrorCode.GUARD_PERMISSION_DENIED);
    }
  }

  private getEffectiveMaxPerSection(
    roleName: string,
    configuredMax: number | null | undefined,
  ): number | null {
    return (
      configuredMax ??
      ClubsService.CANONICAL_ROLE_SLOT_LIMITS_BY_NAME[roleName] ??
      null
    );
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
      throw new AppBadRequestException(ErrorCode.CLUB_NO_ACTIVE_YEAR);
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
      throw new AppBadRequestException(ErrorCode.CLUB_ROLE_IDENTIFIER_REQUIRED);
    }

    const normalizedRoleName = dto.role.trim().toLowerCase();
    if (!normalizedRoleName) {
      throw new AppBadRequestException(ErrorCode.CLUB_ROLE_IDENTIFIER_REQUIRED);
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
      throw new AppBadRequestException(ErrorCode.CLUB_ROLE_NOT_FOUND);
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
