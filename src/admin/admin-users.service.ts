import {
  Inject,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import {
  AppBadRequestException,
  AppConflictException,
  AppForbiddenException,
  AppNotFoundException,
} from '../common/errors/app.exception';
import { ErrorCode } from '../common/errors/error-codes';
import { randomBytes } from 'crypto';
import { Prisma, role_category, user_approval_status } from '@prisma/client';
// NOTE: xlsx 0.18.x is the last Apache-2.0 licensed release available on npm.
// Newer versions are CDN-only. The package has known prototype-pollution advisories
// (SNYK-JS-XLSX-*) — accepted project convention given no viable npm alternative.
import * as XLSX from 'xlsx';
import { BetterAuthService } from '../better-auth/better-auth.service';
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
import { CoordinationService } from '../coordination/coordination.service';
import {
  AdminListUsersQueryDto,
  CreateAdminUserDto,
  CreateAdminUserResponseDto,
  UpdateAdminUserDto,
  UpdateUserApprovalDto,
} from './dto';
import {
  buildFormativeReadModel,
  type CurrentOperationalEnrollmentDto,
  type TrajectoryClassDto,
} from './mappers/formative-read-model.mapper';
import { isDeletedAccountSnapshot } from '../common/utils/deleted-account';

// ── Bulk upload types ────────────────────────────────────────────────────────
export type BulkUserRowResult = {
  row: number;
  email: string | null;
  status: 'success' | 'error';
  user_id?: string;
  invite_email_sent?: boolean;
  error_code?: string;
  error_message?: string;
};

export type BulkUsersResult = {
  total: number;
  succeeded: number;
  failed: number;
  results: BulkUserRowResult[];
};

// ── Scope types ───────────────────────────────────────────────────────────────
type ScopeType = 'ALL' | 'DIVISION' | 'UNION' | 'LOCAL_FIELD' | 'SECTIONS';

interface ActorScope {
  type: ScopeType;
  roles: string[];
  divisionId?: number;
  unionId?: number;
  localFieldId?: number;
  clubSectionIds?: number[];
}

interface ScopeMeta {
  type: ScopeType;
  roles: string[];
  division_id: number | null;
  union_id: number | null;
  local_field_id: number | null;
  club_section_ids: number[] | null;
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
  club_role_assignments: {
    where: {
      active: true,
      roles: {
        active: true,
        role_category: role_category.CLUB,
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
              local_field_id: true,
              church_id: true,
              districlub_type_id: true,
              churches: {
                select: {
                  church_id: true,
                  name: true,
                },
              },
              districts: {
                select: {
                  districlub_type_id: true,
                  name: true,
                },
              },
              local_fields: {
                select: {
                  local_field_id: true,
                  name: true,
                  union_id: true,
                },
              },
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
      relationship_types: {
        select: {
          name: true,
        },
      },
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
      relationship_types: {
        select: {
          name: true,
        },
      },
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
  is_deleted: boolean;
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
  current_cross_type_enrollment: CurrentOperationalEnrollmentDto | null;
  trajectory_classes: TrajectoryClassDto[];
  classes: TrajectoryClassDto[];
  club_assignments: Array<{
    assignment_id: string;
    role_name: string;
    club_name: string | null;
    section_name: string | null;
    district_id: number | null;
    district_name: string | null;
    church_id: number | null;
    church_name: string | null;
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
    private readonly betterAuthService: BetterAuthService,
    private readonly coordinationService: CoordinationService,
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
    const resolvedAuthorization =
      await this.authorizationContext.resolveUserAuthorization(actorUserId);
    const scope = await this.resolveScope(actorUserId, resolvedAuthorization);
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
      current_cross_type_enrollment:
        formativeReadModel.current_cross_type_enrollment,
      trajectory_classes: formativeReadModel.trajectory_classes,
      classes: formativeReadModel.classes,
      club_assignments: user.club_role_assignments.map((assignment) => ({
        assignment_id: assignment.assignment_id,
        role_name: assignment.roles.role_name,
        club_name: assignment.club_sections?.clubs?.name ?? null,
        section_name: assignment.club_sections?.club_types?.name ?? null,
        district_id:
          assignment.club_sections?.clubs?.districlub_type_id ?? null,
        district_name:
          assignment.club_sections?.clubs?.districts?.name ?? null,
        church_id: assignment.club_sections?.clubs?.church_id ?? null,
        church_name:
          assignment.club_sections?.clubs?.churches?.name ?? null,
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

  /**
   * Ordered list of global role hierarchies for scope-check purposes.
   * Each entry is the set of roles an actor at that tier can create.
   * Roles are ordered from highest (super-admin) to lowest (user).
   */
  // Hierarchy rule (Adventist club authority chain):
  //   - super-admin → can create any role, including admin
  //   - admin → can create everything BELOW admin (NOT admin itself; only super-admin
  //     assigns admin); admin assigns director-dia
  //   - director-dia / assistant-dia → assigns UNION roles + below (NOT DIA roles)
  //   - director-union / assistant-union → assigns LF roles + below (NOT UNION roles)
  //   - director-lf / assistant-lf → assigns base roles only (NOT LF roles).
  //     Reason: LF directors are appointed by the union; the LF tier cannot
  //     self-assign or grow its own tier.
  // T5 (base) = user, coordinator, zone-coordinator, general-coordinator, pastor
  private static readonly BASE_T5_ROLES: ReadonlyArray<string> = [
    'user',
    'coordinator',
    'zone-coordinator',
    'general-coordinator',
    'pastor',
  ];
  private static readonly LF_ROLES: ReadonlyArray<string> = [
    'assistant-lf',
    'director-lf',
  ];
  private static readonly UNION_ROLES: ReadonlyArray<string> = [
    'assistant-union',
    'director-union',
  ];
  private static readonly DIA_ROLES: ReadonlyArray<string> = [
    'assistant-dia',
    'director-dia',
  ];
  private static readonly DIVISION_SCOPE_ROLES: ReadonlyArray<string> = [
    'director-dia',
    'assistant-dia',
  ];
  private static readonly UNION_SCOPE_ROLES: ReadonlyArray<string> = [
    'director-union',
    'assistant-union',
  ];
  private static readonly LOCAL_FIELD_SCOPE_ROLES: ReadonlyArray<string> = [
    'director-lf',
    'assistant-lf',
  ];
  private static readonly ADMIN_SCOPE_ROLES: ReadonlyArray<string> = [
    'admin',
    'assistant-admin',
  ];
  private static readonly COORDINATOR_SCOPE_ROLES: ReadonlyArray<string> = [
    'coordinator',
    'zone-coordinator',
    'general-coordinator',
  ];
  private static readonly PASTOR_SCOPE_ROLES: ReadonlyArray<string> = [
    'pastor',
  ];

  private static readonly ROLE_HIERARCHY: ReadonlyArray<{
    actorRoles: ReadonlyArray<string>;
    allowedTargetRoles: ReadonlyArray<string>;
  }> = [
    {
      // super-admin can create any role (DTO already blocks super-admin creation)
      actorRoles: ['super-admin'],
      allowedTargetRoles: [
        ...AdminUsersService.BASE_T5_ROLES,
        ...AdminUsersService.LF_ROLES,
        ...AdminUsersService.UNION_ROLES,
        ...AdminUsersService.DIA_ROLES,
        'admin',
      ],
    },
    {
      // admin assigns down to director-dia, but NOT admin itself
      actorRoles: ['admin'],
      allowedTargetRoles: [
        ...AdminUsersService.BASE_T5_ROLES,
        ...AdminUsersService.LF_ROLES,
        ...AdminUsersService.UNION_ROLES,
        ...AdminUsersService.DIA_ROLES,
      ],
    },
    {
      // DIA assigns down to UNION, NOT DIA peers
      actorRoles: ['director-dia', 'assistant-dia'],
      allowedTargetRoles: [
        ...AdminUsersService.BASE_T5_ROLES,
        ...AdminUsersService.LF_ROLES,
        ...AdminUsersService.UNION_ROLES,
      ],
    },
    {
      // UNION assigns down to LF, NOT UNION peers
      actorRoles: ['director-union', 'assistant-union'],
      allowedTargetRoles: [
        ...AdminUsersService.BASE_T5_ROLES,
        ...AdminUsersService.LF_ROLES,
      ],
    },
    {
      // LF assigns only T5 base roles. Cannot grow its own tier.
      actorRoles: ['director-lf', 'assistant-lf'],
      allowedTargetRoles: [...AdminUsersService.BASE_T5_ROLES],
    },
  ];

  /**
   * Resolves whether the actor is allowed to create a user with the given target role.
   * Returns true if allowed, false if forbidden.
   *
   * Hierarchy (highest to lowest):
   *   super-admin > admin > director-dia/assistant-dia > director-union/assistant-union > director-lf/assistant-lf
   */
  private actorCanCreateRole(
    actorRoles: string[],
    targetRole: string,
  ): boolean {
    return this.resolveAllowedTargetRoles(actorRoles).includes(targetRole);
  }

  /**
   * Resolves the full list of target roles an actor (by their roles) may
   * create. Picks the HIGHEST tier the actor belongs to so a director-dia
   * who also has user/coordinator roles still benefits from the dia scope.
   */
  private resolveAllowedTargetRoles(actorRoles: string[]): string[] {
    for (const tier of AdminUsersService.ROLE_HIERARCHY) {
      if (tier.actorRoles.some((r) => actorRoles.includes(r))) {
        return [...tier.allowedTargetRoles];
      }
    }
    return [];
  }

  /**
   * Public helper: resolve the list of target roles the given actor may
   * assign at creation time. Returns [] if the actor is not in any
   * recognized admin tier.
   */
  async getAllowedTargetRolesForActor(actorId: string): Promise<string[]> {
    const actorRecord = await this.prisma.users.findUnique({
      where: { user_id: actorId },
      select: {
        users_roles: {
          where: {
            active: true,
            roles: { active: true, role_category: role_category.GLOBAL },
          },
          select: { roles: { select: { role_name: true } } },
        },
      },
    });
    const actorRoles = this.extractRoleNames(actorRecord?.users_roles ?? []);
    return this.resolveAllowedTargetRoles(actorRoles);
  }

  /**
   * Admin-initiated single user creation with invite email.
   *
   * Steps:
   *  1. Pre-flight email uniqueness check (before hitting BetterAuthService)
   *  2. Validate target role exists in DB as GLOBAL + active
   *  3. Scope check — actor cannot create a user with a higher role than allowed
   *  4. Generate cryptographically random temp password (memory only, never logged)
   *  5. Create user via BetterAuthService.createUser — discard session/accessToken
   *  6. Update users profile fields (country, union, local_field, access flags)
   *  7. Assign global role via users_roles
   *  8. Trigger password-reset email so the new user can set their own password
   *  9. Return { user_id, email, invite_email_sent }
   */
  async createAdminUser(
    actorId: string,
    dto: CreateAdminUserDto,
  ): Promise<CreateAdminUserResponseDto> {
    // 1. Pre-flight email uniqueness check
    const existing = await this.prisma.users.findUnique({
      where: { email: dto.email },
      select: { user_id: true },
    });
    if (existing) {
      throw new AppConflictException(ErrorCode.AUTH_EMAIL_ALREADY_IN_USE);
    }

    // 2. Validate target role exists in DB
    const matchedRole = await this.prisma.roles.findFirst({
      where: {
        role_name: dto.role,
        role_category: role_category.GLOBAL,
        active: true,
      },
      select: { role_id: true, role_name: true },
    });
    if (!matchedRole) {
      throw new AppBadRequestException(ErrorCode.RBAC_ROLE_NOT_FOUND, {
        role: dto.role,
      });
    }

    // 3. Scope check — resolve actor's global roles and enforce hierarchy
    const actorRecord = await this.prisma.users.findUnique({
      where: { user_id: actorId },
      select: {
        users_roles: {
          where: {
            active: true,
            roles: { active: true, role_category: role_category.GLOBAL },
          },
          select: { roles: { select: { role_name: true } } },
        },
      },
    });
    const actorRoles = this.extractRoleNames(actorRecord?.users_roles ?? []);

    if (!this.actorCanCreateRole(actorRoles, dto.role)) {
      throw new AppForbiddenException(ErrorCode.GUARD_PERMISSION_DENIED);
    }

    // 4. Generate temp password — never logged, exists in memory only
    // 18 random bytes → 24 base64url chars + fixed suffix satisfies most policies
    const tempPassword = `${randomBytes(18).toString('base64url')}Aa1!`;

    const fullName = [dto.name, dto.paternal_last_name, dto.maternal_last_name]
      .filter(Boolean)
      .join(' ');

    // 5. Create user via BetterAuthService — discard session and accessToken
    const { user: baUser } = await this.betterAuthService.createUser(
      dto.email,
      tempPassword,
      fullName,
    );
    const newUserId = baUser.id;

    // 6. Update profile fields. Only fields that exist on the `users` model are set.
    // NOTE: `users` model has no `phone` or `created_by` columns — omitted intentionally.
    const profileData: Prisma.usersUpdateInput = {
      name: dto.name,
      paternal_last_name: dto.paternal_last_name,
      maternal_last_name: dto.maternal_last_name ?? null,
      active: true,
      access_app: true,
      access_panel: true,
    };
    if (dto.country_id !== undefined) {
      profileData.countries = { connect: { country_id: dto.country_id } };
    }
    if (dto.union_id !== undefined) {
      profileData.unions = { connect: { union_id: dto.union_id } };
    }
    if (dto.local_field_id !== undefined) {
      profileData.local_fields = {
        connect: { local_field_id: dto.local_field_id },
      };
    }

    // 7. Assign global role — run profile update and role assignment atomically
    await this.prisma.$transaction([
      this.prisma.users.update({
        where: { user_id: newUserId },
        data: profileData,
      }),
      this.prisma.users_roles.create({
        data: {
          user_id: newUserId,
          role_id: matchedRole.role_id,
          active: true,
        },
      }),
    ]);

    // 8. Send reset-password email so the user can set their own password
    // If email is disabled, catch gracefully — user is already created
    let invite_email_sent = true;
    try {
      await this.betterAuthService.resetPasswordForEmail(dto.email);
    } catch (err) {
      if (err instanceof ServiceUnavailableException) {
        invite_email_sent = false;
        this.logger.warn(
          `Admin user created but invite email not sent (EMAIL_ENABLED=false): user_id=${newUserId}`,
        );
      } else {
        // Re-throw unexpected errors
        throw err;
      }
    }

    // 9. Audit log — no PII, no password
    this.logger.log(
      `Admin user created: user_id=${newUserId} role=${dto.role} actor=${actorId}`,
    );

    return { user_id: newUserId, email: dto.email, invite_email_sent };
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

  private async resolveScope(
    actorUserId: string,
    resolvedAuthorization?: ResolvedAuthorizationProfile,
  ): Promise<ActorScope> {
    const resolved =
      resolvedAuthorization ??
      (await this.authorizationContext.resolveUserAuthorization(actorUserId));
    const roles = this.extractResolvedRoleNames(resolved);

    if (roles.includes('super-admin')) {
      return { type: 'ALL', roles };
    }

    const globalScope = resolved.authorization.effective.scope.global;

    if (this.hasAnyRole(roles, AdminUsersService.DIVISION_SCOPE_ROLES)) {
      const divisionId = globalScope.division?.id;

      if (typeof divisionId === 'number') {
        return { type: 'DIVISION', roles, divisionId };
      }

      throw new AppForbiddenException(ErrorCode.ADMIN_USER_SCOPE_MISSING);
    }

    if (this.hasAnyRole(roles, AdminUsersService.UNION_SCOPE_ROLES)) {
      const unionId = globalScope.union?.id;

      if (typeof unionId === 'number') {
        return { type: 'UNION', roles, unionId };
      }

      throw new AppForbiddenException(ErrorCode.ADMIN_USER_SCOPE_MISSING);
    }

    if (this.hasAnyRole(roles, AdminUsersService.LOCAL_FIELD_SCOPE_ROLES)) {
      const localFieldId = globalScope.local_field?.id;

      if (typeof localFieldId === 'number') {
        return { type: 'LOCAL_FIELD', roles, localFieldId };
      }

      throw new AppForbiddenException(ErrorCode.ADMIN_USER_SCOPE_MISSING);
    }

    if (this.hasAnyRole(roles, AdminUsersService.ADMIN_SCOPE_ROLES)) {
      if (typeof globalScope.union?.id === 'number') {
        return { type: 'UNION', roles, unionId: globalScope.union.id };
      }

      if (typeof globalScope.local_field?.id === 'number') {
        return {
          type: 'LOCAL_FIELD',
          roles,
          localFieldId: globalScope.local_field.id,
        };
      }

      if (typeof globalScope.division?.id === 'number') {
        return {
          type: 'DIVISION',
          roles,
          divisionId: globalScope.division.id,
        };
      }

      throw new AppForbiddenException(ErrorCode.ADMIN_USER_SCOPE_MISSING);
    }

    if (this.hasAnyRole(roles, AdminUsersService.COORDINATOR_SCOPE_ROLES)) {
      const clubSectionIds =
        await this.coordinationService.getEffectiveCoordinatorSectionIds(
          actorUserId,
        );

      if (clubSectionIds.length > 0) {
        return { type: 'SECTIONS', roles, clubSectionIds };
      }

      throw new AppForbiddenException(ErrorCode.ADMIN_USER_SCOPE_MISSING);
    }

    if (this.hasAnyRole(roles, AdminUsersService.PASTOR_SCOPE_ROLES)) {
      const localFieldId = globalScope.local_field?.id;

      if (typeof localFieldId === 'number') {
        return { type: 'LOCAL_FIELD', roles, localFieldId };
      }

      throw new AppForbiddenException(ErrorCode.ADMIN_USER_SCOPE_MISSING);
    }

    if (roles.length === 0) {
      throw new AppForbiddenException(
        ErrorCode.ADMIN_USER_NO_GLOBAL_PERMISSIONS,
      );
    }

    throw new AppForbiddenException(ErrorCode.ADMIN_USER_SCOPE_MISSING);
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
        OR: [
          {
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
          },
          {
            club_role_assignments: {
              some: {
                active: true,
                roles: {
                  active: true,
                  role_category: role_category.CLUB,
                  role_name: {
                    equals: role,
                    mode: 'insensitive',
                  },
                },
              },
            },
          },
        ],
      });
    }

    if (scope.type !== 'SECTIONS') {
      if (query.unionId) {
        filters.push({ union_id: query.unionId });
      }

      if (query.localFieldId) {
        filters.push({ local_field_id: query.localFieldId });
      }
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

    if (scope.type === 'DIVISION') {
      return { unions: { division_id: scope.divisionId! } };
    }

    if (scope.type === 'UNION') {
      return { union_id: scope.unionId! };
    }

    if (scope.type === 'SECTIONS') {
      return {
        club_role_assignments: {
          some: {
            club_section_id: { in: scope.clubSectionIds ?? [] },
            active: true,
          },
        },
      };
    }

    return { local_field_id: scope.localFieldId! };
  }

  private toScopeMeta(scope: ActorScope): ScopeMeta {
    return {
      type: scope.type,
      roles: scope.roles,
      division_id: scope.divisionId ?? null,
      union_id: scope.unionId ?? null,
      local_field_id: scope.localFieldId ?? null,
      club_section_ids: scope.clubSectionIds ?? null,
    };
  }

  private hasAnyRole(
    roles: string[],
    candidates: ReadonlyArray<string>,
  ): boolean {
    return candidates.some((role) => roles.includes(role));
  }

  private extractResolvedRoleNames(
    resolved: ResolvedAuthorizationProfile,
  ): string[] {
    return [
      ...new Set(
        resolved.authorization.grants.global_roles.map((grant) =>
          grant.role_name.toLowerCase(),
        ),
      ),
    ];
  }

  private extractRoleNames(
    assignments: Array<{ roles: { role_name: string } }>,
  ): string[] {
    return [...new Set(assignments.map((item) => item.roles.role_name))];
  }

  private async toListItem(
    user: AdminUserListRecord,
  ): Promise<AdminUserListItem> {
    const roles = [
      ...new Set([
        ...this.extractRoleNames(user.users_roles),
        ...this.extractRoleNames(user.club_role_assignments ?? []),
      ]),
    ].sort((a, b) => a.localeCompare(b));
    const isDeleted = isDeletedAccountSnapshot(user);
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
      is_deleted: isDeleted,
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

  // ── Bulk user upload ────────────────────────────────────────────────────────

  /**
   * Parse and process a bulk user creation file (.xlsx or .csv).
   *
   * Contract:
   *  - HTTP 200 always (per-row results carry status).
   *  - Per-row errors do NOT abort the batch — processing continues.
   *  - Each row delegates to the existing createAdminUser() for full
   *    scope/hierarchy checks and invite email behaviour.
   */
  async bulkCreateAdminUsers(
    actorId: string,
    fileBuffer: Buffer,
    mimeType: string,
  ): Promise<BulkUsersResult> {
    const EXPECTED_HEADERS = [
      'email',
      'name',
      'paternal_last_name',
      'maternal_last_name',
      'role',
      'country_id',
      'union_id',
      'local_field_id',
    ] as const;

    const VALID_ROLES = new Set([
      'user',
      'coordinator',
      'zone-coordinator',
      'general-coordinator',
      'pastor',
      'assistant-lf',
      'director-lf',
      'assistant-union',
      'director-union',
      'assistant-dia',
      'director-dia',
      'admin',
    ]);

    const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

    // 1. Parse the workbook
    const wb = XLSX.read(fileBuffer, {
      type: 'buffer',
      cellDates: false,
      raw: true,
    });

    const sheetName = wb.SheetNames[0];
    if (!sheetName) {
      throw new AppBadRequestException(ErrorCode.ADMIN_BULK_EMPTY_FILE);
    }

    const sheet = wb.Sheets[sheetName];
    // header:1 → array of arrays; defval:'' → missing cells become ''
    const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
      defval: '',
      header: 1,
    });

    if (rows.length < 2) {
      throw new AppBadRequestException(ErrorCode.ADMIN_BULK_EMPTY_FILE);
    }

    // 2. Validate headers (case-insensitive)
    const headerRow = rows[0].map((h) =>
      String(h ?? '')
        .trim()
        .toLowerCase(),
    );
    const normalizedExpected = EXPECTED_HEADERS.map((h) => h.toLowerCase());
    const invalidHeaders = normalizedExpected.filter(
      (h) => !headerRow.includes(h),
    );
    if (invalidHeaders.length > 0) {
      throw new AppBadRequestException(ErrorCode.ADMIN_BULK_INVALID_HEADERS, {
        expected: EXPECTED_HEADERS.join(', '),
        missing: invalidHeaders.join(', '),
      });
    }

    // Build column-index map from actual header row
    const colIndex = (name: string): number =>
      headerRow.indexOf(name.toLowerCase());

    const dataRows = rows.slice(1);

    // 3. Cap at 500 rows
    if (dataRows.length > 500) {
      throw new AppBadRequestException(ErrorCode.ADMIN_BULK_TOO_MANY_ROWS, {
        max: 500,
        received: dataRows.length,
      });
    }

    // 4. Process rows
    const results: BulkUserRowResult[] = [];
    const seenEmails = new Set<string>();
    let succeeded = 0;
    let failed = 0;

    const getCell = (row: unknown[], colName: string): string => {
      const idx = colIndex(colName);
      if (idx < 0) return '';
      return String(row[idx] ?? '').trim();
    };

    const parseOptionalInt = (value: string): number | undefined => {
      if (!value) return undefined;
      const n = parseInt(value, 10);
      return isNaN(n) ? undefined : n;
    };

    for (let i = 0; i < dataRows.length; i++) {
      const rowNumber = i + 2; // 1-indexed, row 1 is headers
      const row = dataRows[i];

      const rawEmail = getCell(row, 'email').toLowerCase();
      const name = getCell(row, 'name');
      const paternalLastName = getCell(row, 'paternal_last_name');
      const maternalLastName = getCell(row, 'maternal_last_name') || undefined;
      const role = getCell(row, 'role');
      const countryIdRaw = getCell(row, 'country_id');
      const unionIdRaw = getCell(row, 'union_id');
      const localFieldIdRaw = getCell(row, 'local_field_id');

      const countryId = parseOptionalInt(countryIdRaw);
      const unionId = parseOptionalInt(unionIdRaw);
      const localFieldId = parseOptionalInt(localFieldIdRaw);

      // Validate required fields
      if (!rawEmail || !name || !paternalLastName || !role) {
        results.push({
          row: rowNumber,
          email: rawEmail || null,
          status: 'error',
          error_code: 'VALIDATION_FAILED',
          error_message:
            'Campos requeridos faltantes: email, name, paternal_last_name, role',
        });
        failed++;
        continue;
      }

      // Validate email format
      if (!EMAIL_REGEX.test(rawEmail)) {
        results.push({
          row: rowNumber,
          email: rawEmail,
          status: 'error',
          error_code: 'VALIDATION_FAILED',
          error_message: `Formato de email inválido: ${rawEmail}`,
        });
        failed++;
        continue;
      }

      // Validate role
      if (!VALID_ROLES.has(role)) {
        results.push({
          row: rowNumber,
          email: rawEmail,
          status: 'error',
          error_code: 'INVALID_ROLE',
          error_message: `Rol inválido: ${role}. Roles válidos: ${[...VALID_ROLES].join(', ')}`,
        });
        failed++;
        continue;
      }

      // Detect duplicate within this file
      if (seenEmails.has(rawEmail)) {
        results.push({
          row: rowNumber,
          email: rawEmail,
          status: 'error',
          error_code: 'DUPLICATE_IN_FILE',
          error_message: `Email duplicado en el archivo: ${rawEmail}`,
        });
        failed++;
        continue;
      }

      // Attempt creation
      try {
        const dto: CreateAdminUserDto = {
          email: rawEmail,
          name,
          paternal_last_name: paternalLastName,
          maternal_last_name: maternalLastName,
          role,
          country_id: countryId,
          union_id: unionId,
          local_field_id: localFieldId,
        };

        const created = await this.createAdminUser(actorId, dto);

        seenEmails.add(rawEmail);
        results.push({
          row: rowNumber,
          email: rawEmail,
          status: 'success',
          user_id: created.user_id,
          invite_email_sent: created.invite_email_sent,
        });
        succeeded++;
      } catch (err: unknown) {
        seenEmails.add(rawEmail); // prevent duplicate processing

        if (
          err instanceof AppConflictException &&
          err.code === ErrorCode.AUTH_EMAIL_ALREADY_IN_USE
        ) {
          results.push({
            row: rowNumber,
            email: rawEmail,
            status: 'error',
            error_code: 'EMAIL_ALREADY_IN_USE',
            error_message: 'El email ya está registrado en el sistema',
          });
        } else if (err instanceof AppForbiddenException) {
          results.push({
            row: rowNumber,
            email: rawEmail,
            status: 'error',
            error_code: 'FORBIDDEN_ROLE_FOR_ACTOR',
            error_message:
              'El actor no tiene permiso para crear usuarios con ese rol',
          });
        } else {
          const message =
            err instanceof Error
              ? err.message.substring(0, 200)
              : 'Error interno desconocido';
          results.push({
            row: rowNumber,
            email: rawEmail,
            status: 'error',
            error_code: 'INTERNAL_ERROR',
            error_message: message,
          });
        }
        failed++;
      }
    }

    return {
      total: dataRows.length,
      succeeded,
      failed,
      results,
    };
  }

  /**
   * Build an in-memory .xlsx template buffer for bulk user upload.
   * Sheet "Usuarios": row 1 headers, row 2 example values.
   * Sheet "Roles permitidos": ONLY the role slugs the calling actor is
   * authorized to assign (filtered by `ROLE_HIERARCHY`). This prevents
   * confusion where a Local-Field assistant sees admin/director-dia in the
   * reference sheet but cannot actually create them.
   */
  async getBulkTemplateBuffer(actorId: string): Promise<Buffer> {
    const allowedRoles = await this.getAllowedTargetRolesForActor(actorId);
    return this.buildBulkTemplateBuffer(allowedRoles);
  }

  /**
   * Static label map for global role slugs. Keep in sync with frontend
   * `role-labels.ts` and DB seeds.
   */
  private static readonly ROLE_LABELS_ES: Record<string, string> = {
    user: 'Usuario',
    coordinator: 'Coordinador',
    'zone-coordinator': 'Coordinador de Zona',
    'general-coordinator': 'Coordinador General',
    pastor: 'Pastor',
    'assistant-lf': 'Secretario de Campo Local',
    'director-lf': 'Director de Campo Local',
    'assistant-union': 'Secretario de Unión',
    'director-union': 'Director de Unión',
    'assistant-dia': 'Secretario de División',
    'director-dia': 'Director de División',
    admin: 'Administrador',
  };

  /**
   * Pure builder used by both the public actor-scoped entrypoint and tests.
   */
  private buildBulkTemplateBuffer(allowedRoles: string[]): Buffer {
    const wb = XLSX.utils.book_new();

    // Pick an example role the actor can actually use. Default to 'user'
    // since every authorized tier can create T5 base roles.
    const exampleRole = allowedRoles.includes('user')
      ? 'user'
      : (allowedRoles[0] ?? 'user');

    const usersData = [
      [
        'email',
        'name',
        'paternal_last_name',
        'maternal_last_name',
        'role',
        'country_id',
        'union_id',
        'local_field_id',
      ],
      ['juan@ejemplo.com', 'Juan', 'Pérez', 'López', exampleRole, 1, 12, 34],
    ];

    const usersSheet = XLSX.utils.aoa_to_sheet(usersData);
    XLSX.utils.book_append_sheet(wb, usersSheet, 'Usuarios');

    const rolesData: Array<[string, string]> = [['slug', 'etiqueta']];
    for (const slug of allowedRoles) {
      const label = AdminUsersService.ROLE_LABELS_ES[slug] ?? slug;
      rolesData.push([slug, label]);
    }

    const rolesSheet = XLSX.utils.aoa_to_sheet(rolesData);
    XLSX.utils.book_append_sheet(wb, rolesSheet, 'Roles permitidos');

    return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
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
