import {
  Inject,
  Injectable,
  Logger,
} from '@nestjs/common';
import {
  AppForbiddenException,
  AppNotFoundException,
} from '../common/errors/app.exception';
import { ErrorCode } from '../common/errors/error-codes';
import { Prisma, role_category, user_approval_status } from '@prisma/client';
import {
  createPaginatedResult,
  PaginationDto,
} from '../common/dto/pagination.dto';
import {
  AuthorizationContextService,
  type ResolvedAuthorizationProfile,
} from '../common/services/authorization-context.service';
import {
  getSensitiveUserSubresourcePolicy,
  type SensitiveUserSubresourceFamily,
} from '../common/guards/sensitive-user-subresource-policy';
import {
  FILE_STORAGE_SERVICE,
  StorageBucketAlias,
} from '../common/services/file-storage.service';
import type { FileStorageService } from '../common/services/file-storage.service';
import { PrismaService } from '../prisma/prisma.service';
import {
  AdminListUsersQueryDto,
  UpdateAdminUserDto,
  UpdateUserApprovalDto,
} from './dto';
import {
  buildFormativeReadModel,
  type CurrentOperationalEnrollmentDto,
  type TrajectoryClassDto,
} from './mappers/formative-read-model.mapper';

type ScopeType = 'ALL' | 'UNION' | 'LOCAL_FIELD';

interface ActorScope {
  type: ScopeType;
  roles: string[];
  unionId?: number;
  localFieldId?: number;
}

interface ScopeMeta {
  type: ScopeType;
  roles: string[];
  union_id: number | null;
  local_field_id: number | null;
}

interface AdminUsersListResult<T> {
  data: T[];
  meta: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
    hasNextPage: boolean;
    hasPreviousPage: boolean;
    scope: ScopeMeta;
  };
}

const adminUserListSelect = Prisma.validator<Prisma.usersSelect>()({
  user_id: true,
  email: true,
  name: true,
  paternal_last_name: true,
  maternal_last_name: true,
  user_image: true,
  active: true,
  access_app: true,
  access_panel: true,
  country_id: true,
  union_id: true,
  local_field_id: true,
  created_at: true,
  countries: {
    select: {
      country_id: true,
      name: true,
    },
  },
  unions: {
    select: {
      union_id: true,
      name: true,
    },
  },
  local_fields: {
    select: {
      local_field_id: true,
      union_id: true,
      name: true,
    },
  },
  users_roles: {
    where: {
      active: true,
      roles: {
        active: true,
        role_category: role_category.GLOBAL,
      },
    },
    select: {
      roles: {
        select: {
          role_name: true,
        },
      },
    },
  },
  users_pr: {
    select: {
      complete: true,
      profile_picture_complete: true,
      personal_info_complete: true,
      club_selection_complete: true,
    },
  },
});

const adminUserDetailSelect = Prisma.validator<Prisma.usersSelect>()({
  ...adminUserListSelect,
  gender: true,
  birthday: true,
  blood: true,
  baptism: true,
  baptism_date: true,
  modified_at: true,
  users_roles: {
    where: {
      active: true,
      roles: {
        active: true,
        role_category: role_category.GLOBAL,
      },
    },
    select: {
      role_id: true,
      roles: {
        select: {
          role_name: true,
        },
      },
    },
  },
  users_pr: {
    select: {
      complete: true,
      profile_picture_complete: true,
      personal_info_complete: true,
      club_selection_complete: true,
      date_completed: true,
    },
  },
  enrollments: {
    where: { active: true },
    orderBy: { ecclesiastical_year_id: 'desc' },
    select: {
      enrollment_id: true,
      class_id: true,
      ecclesiastical_year_id: true,
      advanced_status: true,
      active: true,
      enrollment_date: true,
      investiture_status: true,
      investiture_date: true,
      classes: {
        select: {
          name: true,
        },
      },
      ecclesiastical_year: {
        select: {
          start_date: true,
          end_date: true,
        },
      },
    },
  },
  club_role_assignments: {
    where: { active: true },
    orderBy: { created_at: 'desc' },
    select: {
      assignment_id: true,
      role_id: true,
      club_section_id: true,
      ecclesiastical_year_id: true,
      start_date: true,
      end_date: true,
      roles: {
        select: {
          role_name: true,
        },
      },
      ecclesiastical_year: {
        select: {
          year_id: true,
          start_date: true,
          end_date: true,
        },
      },
      club_sections: {
        select: {
          club_section_id: true,
          club_type_id: true,
          club_types: {
            select: {
              name: true,
            },
          },
          clubs: {
            select: {
              club_id: true,
              name: true,
            },
          },
        },
      },
    },
  },
  emergency_contact: {
    where: { active: true },
    orderBy: { created_at: 'desc' },
    select: {
      emergency_id: true,
      name: true,
      phone: true,
      primary: true,
      relationship_type_id: true,
    },
  },
  legal_representative: {
    select: {
      id: true,
      representative_user_id: true,
      relationship_type_id: true,
      name: true,
      paternal_last_name: true,
      maternal_last_name: true,
      phone: true,
    },
  },
  users_allergies: {
    where: { active: true },
    orderBy: { allergy_id: 'asc' },
    select: {
      allergy_id: true,
      allergies: {
        select: {
          name: true,
        },
      },
    },
  },
  users_diseases: {
    where: { active: true },
    orderBy: { disease_id: 'asc' },
    select: {
      disease_id: true,
      diseases: {
        select: {
          name: true,
        },
      },
    },
  },
  users_medicines: {
    where: { active: true },
    orderBy: { medicine_id: 'asc' },
    select: {
      medicine_id: true,
      medicines: {
        select: {
          name: true,
        },
      },
    },
  },
});

const adminEnrollmentSelect = Prisma.validator<Prisma.enrollmentsSelect>()({
  enrollment_id: true,
  ecclesiastical_year_id: true,
  class_id: true,
  enrollment_date: true,
  investiture_status: true,
  submitted_for_validation: true,
  submitted_at: true,
  validated_by: true,
  validated_at: true,
  rejection_reason: true,
  investiture_date: true,
  advanced_status: true,
  locked_for_validation: true,
  cross_type_enrollment: true,
  active: true,
  classes: {
    select: {
      name: true,
    },
  },
});

type AdminUserListRecord = Prisma.usersGetPayload<{
  select: typeof adminUserListSelect;
}>;
type AdminUserDetailRecord = Prisma.usersGetPayload<{
  select: typeof adminUserDetailSelect;
}>;
type ClubAssignmentRecord =
  AdminUserDetailRecord['club_role_assignments'][number];

interface SensitiveHealthBlock {
  blood: AdminUserDetailRecord['blood'];
  allergies: Array<{ allergy_id: number; name: string | null }>;
  diseases: Array<{ disease_id: number; name: string | null }>;
  medicines: Array<{ medicine_id: number; name: string | null }>;
}

interface MinimalPostRegistrationBlock {
  complete: boolean;
  profile_picture_complete: boolean;
  personal_info_complete: boolean;
  club_selection_complete: boolean;
  date_completed: Date | null;
}

interface AdminUserListItem {
  user_id: string;
  email: string;
  name: string | null;
  paternal_last_name: string | null;
  maternal_last_name: string | null;
  full_name: string;
  user_image: string | null;
  active: boolean;
  access_app: boolean;
  access_panel: boolean;
  country: { country_id: number; name: string } | null;
  union: { union_id: number; name: string } | null;
  local_field: {
    local_field_id: number;
    union_id: number | null;
    name: string;
  } | null;
  roles: string[];
  post_registration: {
    complete: boolean;
    profile_picture_complete: boolean;
    personal_info_complete: boolean;
    club_selection_complete: boolean;
  } | null;
  created_at: Date;
}

interface AdminUserDetail extends AdminUserListItem {
  gender: string | null;
  birthday: Date | null;
  blood: AdminUserDetailRecord['blood'] | null;
  baptism: boolean | null;
  baptism_date: Date | null;
  modified_at: Date;
  current_operational_enrollment: CurrentOperationalEnrollmentDto | null;
  trajectory_classes: TrajectoryClassDto[];
  classes: TrajectoryClassDto[];
  club_assignments: Array<{
    assignment_id: string;
    role_name: string;
    start_date: Date;
    end_date: Date | null;
    ecclesiastical_year: ClubAssignmentRecord['ecclesiastical_year'];
    club: {
      type: 'adventurers' | 'pathfinders' | 'master_guides';
      instance_id: number;
      club: { club_id: number; name: string } | null;
    } | null;
  }>;
  health: SensitiveHealthBlock | null;
  emergency_contacts: AdminUserDetailRecord['emergency_contact'] | null;
  legal_representative: AdminUserDetailRecord['legal_representative'] | null;
  post_registration: MinimalPostRegistrationBlock | null;
  scope: ScopeMeta;
}

@Injectable()
export class AdminUsersService {
  private readonly logger = new Logger(AdminUsersService.name);
  private static readonly PRIVATE_ASSET_URL_TTL_SECONDS = 300;

  constructor(
    private readonly prisma: PrismaService,
    private readonly authorizationContext: AuthorizationContextService,
    @Inject(FILE_STORAGE_SERVICE)
    private readonly fileStorage: FileStorageService,
  ) {}

  async listUsers(
    actorUserId: string,
    query: AdminListUsersQueryDto,
  ): Promise<AdminUsersListResult<AdminUserListItem>> {
    const scope = await this.resolveScope(actorUserId);

    const pagination = new PaginationDto();
    pagination.page = query.page ?? 1;
    pagination.limit = query.limit ?? 20;

    const where = this.buildListWhere(scope, query);

    const [users, total] = await Promise.all([
      this.prisma.users.findMany({
        where,
        orderBy: { created_at: 'desc' },
        skip: pagination.skip,
        take: pagination.take,
        select: adminUserListSelect,
      }),
      this.prisma.users.count({ where }),
    ]);

    const data = await Promise.all(users.map((user) => this.toListItem(user)));
    const paginated = createPaginatedResult(data, total, pagination);

    return {
      data: paginated.data,
      meta: {
        ...paginated.meta,
        scope: this.toScopeMeta(scope),
      },
    };
  }

  async getUserById(
    actorUserId: string,
    userId: string,
  ): Promise<AdminUserDetail> {
    const scope = await this.resolveScope(actorUserId);
    const resolvedAuthorization =
      await this.authorizationContext.resolveUserAuthorization(actorUserId);
    const actorGlobalPermissions = this.getActorGlobalPermissions(
      resolvedAuthorization,
    );

    const filters: Prisma.usersWhereInput[] = [{ user_id: userId }];
    const scopedFilter = this.buildScopeWhere(scope);
    if (Object.keys(scopedFilter).length > 0) {
      filters.push(scopedFilter);
    }

    const user = await this.prisma.users.findFirst({
      where: { AND: filters },
      select: adminUserDetailSelect,
    });

    if (!user) {
      throw new AppNotFoundException(ErrorCode.ADMIN_USER_NOT_FOUND);
    }

    const activeEcclesiasticalYearId =
      await this.resolveActiveEcclesiasticalYearId();

    const enrollmentCandidates =
      activeEcclesiasticalYearId === null
        ? []
        : await this.prisma.enrollments.findMany({
            where: {
              user_id: user.user_id,
              ecclesiastical_year_id: activeEcclesiasticalYearId,
              active: true,
            },
            orderBy: { enrollment_date: 'desc' },
            select: adminEnrollmentSelect,
          });

    const formativeReadModel = buildFormativeReadModel({
      activeEcclesiasticalYearId,
      enrollments: enrollmentCandidates,
      trajectoryClasses: user.enrollments,
    });

    if (formativeReadModel.conflictEnrollmentIds.length > 0) {
      this.logger.warn({
        event: 'formative_read_model_conflict',
        userId: user.user_id,
        ecclesiasticalYearId: activeEcclesiasticalYearId,
        enrollmentIds: formativeReadModel.conflictEnrollmentIds,
        source: 'admin-user-detail',
      });
    }

    const listItem = await this.toListItem(user);
    const sensitiveBlocks = this.buildSensitiveBlocks(
      user,
      actorGlobalPermissions,
    );

    return {
      ...listItem,
      gender: user.gender,
      birthday: user.birthday,
      blood: sensitiveBlocks.health ? user.blood : null,
      baptism: user.baptism,
      baptism_date: user.baptism_date,
      user_image: listItem.user_image,
      modified_at: user.modified_at,
      current_operational_enrollment:
        formativeReadModel.current_operational_enrollment,
      trajectory_classes: formativeReadModel.trajectory_classes,
      classes: formativeReadModel.classes,
      club_assignments: user.club_role_assignments.map((assignment) => ({
        assignment_id: assignment.assignment_id,
        role_name: assignment.roles.role_name,
        start_date: assignment.start_date,
        end_date: assignment.end_date,
        ecclesiastical_year: assignment.ecclesiastical_year,
        club: this.resolveClubAssignment(assignment),
      })),
      health: sensitiveBlocks.health,
      emergency_contacts: sensitiveBlocks.emergency_contacts,
      legal_representative: sensitiveBlocks.legal_representative,
      post_registration: sensitiveBlocks.post_registration,
      scope: this.toScopeMeta(scope),
    };
  }

  async updateUserApproval(userId: string, dto: UpdateUserApprovalDto) {
    return this.prisma.users.update({
      where: { user_id: userId },
      data: {
        approval_status: dto.approved
          ? user_approval_status.approved
          : user_approval_status.rejected,
        rejection_reason: dto.approved ? null : (dto.rejection_reason ?? null),
        active: dto.approved,
      },
    });
  }

  async updateUser(userId: string, dto: UpdateAdminUserDto) {
    // Build an explicit update payload so that only known Prisma columns are
    // forwarded. This guards against clients that send legacy field names such
    // as `approval` (numeric) or `approved` (bool) that no longer exist on the
    // users table.
    const data: Parameters<typeof this.prisma.users.update>[0]['data'] = {};

    if (typeof dto.active === 'boolean') data.active = dto.active;
    if (typeof dto.access_app === 'boolean') data.access_app = dto.access_app;
    if (typeof dto.access_panel === 'boolean')
      data.access_panel = dto.access_panel;
    if (dto.approval_status !== undefined)
      data.approval_status = dto.approval_status;
    if (typeof dto.rejection_reason === 'string')
      data.rejection_reason = dto.rejection_reason;

    return this.prisma.users.update({
      where: { user_id: userId },
      data,
    });
  }

  private async resolveActiveEcclesiasticalYearId(): Promise<number | null> {
    const currentYear = await this.prisma.ecclesiastical_years.findFirst({
      where: {
        start_date: { lte: new Date() },
        end_date: { gte: new Date() },
      },
      select: {
        year_id: true,
      },
    });

    return currentYear?.year_id ?? null;
  }

  private getActorGlobalPermissions(
    resolvedAuthorization: ResolvedAuthorizationProfile,
  ): Set<string> {
    return new Set(
      resolvedAuthorization.authorization.grants.global_roles.flatMap(
        (grant) => grant.permissions,
      ),
    );
  }

  private buildSensitiveBlocks(
    user: AdminUserDetailRecord,
    actorGlobalPermissions: Set<string>,
  ): {
    health: SensitiveHealthBlock | null;
    emergency_contacts: AdminUserDetailRecord['emergency_contact'] | null;
    legal_representative: AdminUserDetailRecord['legal_representative'] | null;
    post_registration: MinimalPostRegistrationBlock | null;
  } {
    return {
      health: this.canReadSensitiveFamily(actorGlobalPermissions, 'health')
        ? this.buildHealthBlock(user)
        : null,
      emergency_contacts: this.canReadSensitiveFamily(
        actorGlobalPermissions,
        'emergency_contacts',
      )
        ? user.emergency_contact
        : null,
      legal_representative: this.canReadSensitiveFamily(
        actorGlobalPermissions,
        'legal_representative',
      )
        ? user.legal_representative
        : null,
      post_registration: this.canReadSensitiveFamily(
        actorGlobalPermissions,
        'post_registration',
      )
        ? this.buildMinimalPostRegistrationBlock(user)
        : null,
    };
  }

  private canReadSensitiveFamily(
    actorGlobalPermissions: Set<string>,
    family: SensitiveUserSubresourceFamily,
  ): boolean {
    const policy = getSensitiveUserSubresourcePolicy(family, 'read');

    return (
      actorGlobalPermissions.has(policy.finePermission) ||
      actorGlobalPermissions.has(policy.legacyFallbackPermission)
    );
  }

  private buildHealthBlock(user: AdminUserDetailRecord): SensitiveHealthBlock {
    return {
      blood: user.blood,
      allergies: (user.users_allergies ?? [])
        .filter(
          (item): item is typeof item & { allergy_id: number } =>
            item.allergy_id !== null,
        )
        .map((item) => ({
          allergy_id: item.allergy_id,
          name: item.allergies?.name ?? null,
        })),
      diseases: (user.users_diseases ?? []).map((item) => ({
        disease_id: item.disease_id,
        name: item.diseases?.name ?? null,
      })),
      medicines: (user.users_medicines ?? []).map((item) => ({
        medicine_id: item.medicine_id,
        name: item.medicines?.name ?? null,
      })),
    };
  }

  private buildMinimalPostRegistrationBlock(
    user: AdminUserDetailRecord,
  ): MinimalPostRegistrationBlock | null {
    const latestPostRegistration = user.users_pr ?? null;

    if (!latestPostRegistration) {
      return null;
    }

    return {
      complete: latestPostRegistration.complete,
      profile_picture_complete: latestPostRegistration.profile_picture_complete,
      personal_info_complete: latestPostRegistration.personal_info_complete,
      club_selection_complete: latestPostRegistration.club_selection_complete,
      date_completed: latestPostRegistration.date_completed ?? null,
    };
  }

  private async resolveScope(actorUserId: string): Promise<ActorScope> {
    const actor = await this.prisma.users.findUnique({
      where: { user_id: actorUserId },
      select: {
        user_id: true,
        union_id: true,
        local_field_id: true,
        users_roles: {
          where: {
            active: true,
            roles: {
              active: true,
              role_category: role_category.GLOBAL,
            },
          },
          select: {
            roles: {
              select: {
                role_name: true,
              },
            },
          },
        },
      },
    });

    if (!actor) {
      throw new AppForbiddenException(ErrorCode.ADMIN_USER_NOT_FOUND);
    }

    const roles = this.extractRoleNames(actor.users_roles);

    if (roles.includes('super_admin')) {
      return { type: 'ALL', roles };
    }

    const hasAdminLevelRole =
      roles.includes('admin') || roles.includes('assistant_admin');

    if (hasAdminLevelRole) {
      if (actor.union_id) {
        return { type: 'UNION', roles, unionId: actor.union_id };
      }

      if (actor.local_field_id) {
        return {
          type: 'LOCAL_FIELD',
          roles,
          localFieldId: actor.local_field_id,
        };
      }

      throw new AppForbiddenException(ErrorCode.ADMIN_USER_SCOPE_MISSING);
    }

    if (roles.includes('coordinator')) {
      if (actor.local_field_id) {
        return {
          type: 'LOCAL_FIELD',
          roles,
          localFieldId: actor.local_field_id,
        };
      }

      throw new AppForbiddenException(ErrorCode.ADMIN_USER_SCOPE_MISSING);
    }

    throw new AppForbiddenException(ErrorCode.ADMIN_USER_NO_GLOBAL_PERMISSIONS);
  }

  private buildListWhere(
    scope: ActorScope,
    query: AdminListUsersQueryDto,
  ): Prisma.usersWhereInput {
    const filters: Prisma.usersWhereInput[] = [];
    const scopedFilter = this.buildScopeWhere(scope);

    if (Object.keys(scopedFilter).length > 0) {
      filters.push(scopedFilter);
    }

    if (typeof query.active === 'boolean') {
      filters.push({ active: query.active });
    }

    const search = query.search?.trim();
    if (search) {
      filters.push({
        OR: [
          { email: { contains: search, mode: 'insensitive' } },
          { name: { contains: search, mode: 'insensitive' } },
          { paternal_last_name: { contains: search, mode: 'insensitive' } },
          { maternal_last_name: { contains: search, mode: 'insensitive' } },
        ],
      });
    }

    const role = query.role?.trim();
    if (role) {
      filters.push({
        users_roles: {
          some: {
            active: true,
            roles: {
              active: true,
              role_category: role_category.GLOBAL,
              role_name: {
                equals: role,
                mode: 'insensitive',
              },
            },
          },
        },
      });
    }

    if (query.unionId) {
      filters.push({ union_id: query.unionId });
    }

    if (query.localFieldId) {
      filters.push({ local_field_id: query.localFieldId });
    }

    if (filters.length === 0) {
      return {};
    }

    if (filters.length === 1) {
      return filters[0];
    }

    return { AND: filters };
  }

  private buildScopeWhere(scope: ActorScope): Prisma.usersWhereInput {
    if (scope.type === 'ALL') {
      return {};
    }

    if (scope.type === 'UNION') {
      return { union_id: scope.unionId! };
    }

    return { local_field_id: scope.localFieldId! };
  }

  private toScopeMeta(scope: ActorScope): ScopeMeta {
    return {
      type: scope.type,
      roles: scope.roles,
      union_id: scope.unionId ?? null,
      local_field_id: scope.localFieldId ?? null,
    };
  }

  private extractRoleNames(
    assignments: Array<{ roles: { role_name: string } }>,
  ): string[] {
    return [...new Set(assignments.map((item) => item.roles.role_name))];
  }

  private async toListItem(
    user: AdminUserListRecord,
  ): Promise<AdminUserListItem> {
    const roles = this.extractRoleNames(user.users_roles).sort((a, b) =>
      a.localeCompare(b),
    );
    const postRegistration = user.users_pr
      ? {
          complete: user.users_pr.complete,
          profile_picture_complete: user.users_pr.profile_picture_complete,
          personal_info_complete: user.users_pr.personal_info_complete,
          club_selection_complete: user.users_pr.club_selection_complete,
        }
      : null;

    return {
      user_id: user.user_id,
      email: user.email,
      name: user.name,
      paternal_last_name: user.paternal_last_name,
      maternal_last_name: user.maternal_last_name,
      full_name: [user.name, user.paternal_last_name, user.maternal_last_name]
        .filter(Boolean)
        .join(' ')
        .trim(),
      user_image: await this.resolvePrivateProfileUrl(user.user_image),
      active: user.active,
      access_app: user.access_app ?? false,
      access_panel: user.access_panel ?? false,
      country: user.countries
        ? {
            country_id: user.countries.country_id,
            name: user.countries.name,
          }
        : null,
      union: user.unions
        ? {
            union_id: user.unions.union_id,
            name: user.unions.name,
          }
        : null,
      local_field: user.local_fields
        ? {
            local_field_id: user.local_fields.local_field_id,
            union_id: user.local_fields.union_id,
            name: user.local_fields.name,
          }
        : null,
      roles,
      post_registration: postRegistration,
      created_at: user.created_at,
    };
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
          expiresInSeconds: AdminUsersService.PRIVATE_ASSET_URL_TTL_SECONDS,
        },
      );
    } catch (error) {
      this.logger.warn(
        'Failed to generate signed URL for admin user profile. Returning original value.',
        error,
      );
      return value;
    }
  }

  private resolveClubAssignment(
    assignment: ClubAssignmentRecord,
  ): AdminUserDetail['club_assignments'][number]['club'] {
    if (assignment.club_sections) {
      const typeName =
        assignment.club_sections.club_types?.name?.toLowerCase() ?? '';
      let type: 'adventurers' | 'pathfinders' | 'master_guides' = 'pathfinders';
      if (typeName.includes('aventurero') || typeName.includes('adventurer')) {
        type = 'adventurers';
      } else if (
        typeName.includes('guía') ||
        typeName.includes('master') ||
        typeName.includes('guild')
      ) {
        type = 'master_guides';
      }

      return {
        type,
        instance_id: assignment.club_sections.club_section_id,
        club: assignment.club_sections.clubs,
      };
    }

    return null;
  }
}
