import { Injectable, UnauthorizedException, Inject, Logger } from '@nestjs/common';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import type { Cache } from 'cache-manager';
import { PrismaService } from '../../prisma/prisma.service';

export type AuthorizationScopeNode = {
  id: number | string;
  name?: string | null;
};

export type AuthorizationTerritoryScope = {
  country?: AuthorizationScopeNode;
  union?: AuthorizationScopeNode;
  local_field?: AuthorizationScopeNode;
};

export type GlobalAuthorizationGrant = {
  role_name: string;
  permissions: string[];
  scope: AuthorizationTerritoryScope;
};

export type ClubAuthorizationGrant = {
  assignment_id: string;
  role_name: string;
  permissions: string[];
  club: {
    club_id: number;
    club_name: string;
  };
  section: {
    club_section_id: number;
    club_type_name?: string | null;
  };
  scope: AuthorizationTerritoryScope;
  status: string;
  start_date?: Date | null;
  end_date?: Date | null;
  expires_at?: Date | null;
};

export type EffectiveClubAuthorization = {
  assignment_id: string;
  role_name: string;
  club: {
    club_id: number;
    club_name: string;
  };
  section: {
    club_section_id: number;
    club_type_name?: string | null;
  };
};

export type AuthorizationSnapshot = {
  grants: {
    global_roles: GlobalAuthorizationGrant[];
    club_assignments: ClubAuthorizationGrant[];
  };
  active_assignment: {
    assignment_id: string | null;
  };
  effective: {
    permissions: string[];
    scope: {
      global: AuthorizationTerritoryScope;
      club: EffectiveClubAuthorization | null;
    };
  };
};

export type LegacyAssignmentContext = {
  assignment_id: string;
  role_name: string;
  club_section_id: number;
  club_id: number;
  club_name: string;
  club_type: string | null;
};

export type ResolvedAuthorizationProfile = {
  profile: {
    user_id: string;
    email: string;
    name: string | null;
    paternal_last_name: string | null;
    maternal_last_name: string | null;
    gender: string | null;
    birthday: Date | null;
    baptism: boolean;
    baptism_date: Date | null;
    user_image: string | null;
    country_id: number | null;
    union_id: number | null;
    local_field_id: number | null;
    created_at: Date;
  };
  post_register_complete: boolean;
  authorization: AuthorizationSnapshot;
  legacy: {
    roles: string[];
    permissions: string[];
    club: {
      club_id: number;
      club_name: string;
      club_type: string | null;
    } | null;
    club_context: {
      active_assignment_id: string | null;
      active: LegacyAssignmentContext | null;
      available: LegacyAssignmentContext[];
    };
  };
};

type RolePermissionRecord = {
  permissions?: {
    permission_name?: string | null;
  } | null;
};

type ClubHierarchyRecord = {
  club_id: number;
  name: string | null;
  local_fields?: {
    local_field_id: number;
    name: string | null;
    unions?: {
      union_id: number;
      name: string | null;
      countries?: {
        country_id: number;
        name: string | null;
      } | null;
    } | null;
  } | null;
};

type ClubAssignmentRecord = {
  assignment_id: string;
  status: string | null;
  start_date: Date | null;
  end_date: Date | null;
  expires_at: Date | null;
  roles: {
    role_name: string;
    role_permissions: RolePermissionRecord[];
  };
  club_sections?: {
    club_section_id: number;
    club_types?: { name: string | null } | null;
    clubs?: ClubHierarchyRecord | null;
  } | null;
};

/**
 * Cache key for a user's resolved authorization context.
 * Convention mirrors CATALOG_CACHE_KEYS: `auth:context:{userId}`
 */
export const AUTH_CONTEXT_CACHE_KEY = (userId: string): string =>
  `auth:context:${userId}`;

/**
 * TTL for user authorization context — 5 minutes in milliseconds.
 * Auth context changes infrequently (role/assignment mutations are rare),
 * so a mid-range TTL balances freshness with DB load reduction.
 */
const AUTH_CONTEXT_TTL_MS = 300_000; // 5 minutes

const CLUB_SCOPE_SELECT = {
  club_id: true,
  name: true,
  local_fields: {
    select: {
      local_field_id: true,
      name: true,
      unions: {
        select: {
          union_id: true,
          name: true,
          countries: {
            select: {
              country_id: true,
              name: true,
            },
          },
        },
      },
    },
  },
} as const;

@Injectable()
export class AuthorizationContextService {
  private readonly logger = new Logger(AuthorizationContextService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(CACHE_MANAGER) private readonly cacheManager: Cache,
  ) {}

  /**
   * Invalidate the cached authorization context for a specific user.
   * Call this whenever a user's roles, global permissions, or club assignments
   * are mutated so that the next request reflects the updated state.
   *
   * Mutation points that MUST call this method:
   *   - RbacService.assignRoleToUser / removeRoleFromUser / bootstrapAdmin
   *   - RbacService.assignPermissionsToRole / removePermissionFromRole / syncRolePermissions
   *     (affects all users that hold the modified role — per-role invalidation is not
   *      implemented; rely on TTL expiry for role-level permission changes)
   *   - ClubsService.assignRole / updateRoleAssignment / removeRoleAssignment
   *   - MembershipRequestsService.approve / reject
   *   - RequestsService / PostRegistrationService when creating or mutating assignments
   */
  async invalidateUserAuthorizationCache(userId: string): Promise<void> {
    const key = AUTH_CONTEXT_CACHE_KEY(userId);
    try {
      await this.cacheManager.del(key);
      this.logger.debug(`Auth context cache INVALIDATED — ${key}`);
    } catch (err) {
      this.logger.warn(
        `Auth context cache DEL fallido para "${key}": ${this.extractMessage(err)}`,
      );
    }
  }

  async resolveUserAuthorization(
    userId: string,
  ): Promise<ResolvedAuthorizationProfile> {
    const cacheKey = AUTH_CONTEXT_CACHE_KEY(userId);

    // ── Cache HIT path ──────────────────────────────────────────────────────
    try {
      const cached =
        await this.cacheManager.get<ResolvedAuthorizationProfile>(cacheKey);
      if (cached !== null && cached !== undefined) {
        this.logger.debug(`Auth context cache HIT  — ${cacheKey}`);
        return cached;
      }
    } catch (err) {
      // Redis down or deserialization error — degrade gracefully to DB
      this.logger.warn(
        `Auth context cache GET fallido para "${cacheKey}": ${this.extractMessage(err)}`,
      );
    }

    this.logger.debug(`Auth context cache MISS — ${cacheKey}`);

    // ── DB query (unchanged) ────────────────────────────────────────────────
    const user = await this.prisma.users.findUnique({
      where: { user_id: userId },
      select: {
        user_id: true,
        email: true,
        name: true,
        paternal_last_name: true,
        maternal_last_name: true,
        gender: true,
        birthday: true,
        baptism: true,
        baptism_date: true,
        user_image: true,
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
            name: true,
          },
        },
        users_pr: {
          select: {
            complete: true,
            active_club_assignment_id: true,
          },
        },
        users_roles: {
          where: {
            active: true,
            roles: {
              active: true,
              role_category: 'GLOBAL',
            },
          },
          select: {
            roles: {
              select: {
                role_name: true,
                role_permissions: {
                  where: { active: true },
                  select: {
                    permissions: {
                      select: {
                        permission_name: true,
                      },
                    },
                  },
                },
              },
            },
          },
        },
        club_role_assignments: {
          where: { active: true },
          orderBy: { start_date: 'desc' },
          select: {
            assignment_id: true,
            status: true,
            start_date: true,
            end_date: true,
            expires_at: true,
            roles: {
              select: {
                role_name: true,
                role_permissions: {
                  where: { active: true },
                  select: {
                    permissions: {
                      select: {
                        permission_name: true,
                      },
                    },
                  },
                },
              },
            },
            club_sections: {
              select: {
                club_section_id: true,
                club_types: { select: { name: true } },
                clubs: { select: CLUB_SCOPE_SELECT },
              },
            },
          },
        },
      },
    });

    if (!user) {
      throw new UnauthorizedException('Usuario no encontrado');
    }

    const globalScope = this.buildUserScope(user);
    const globalGrants = user.users_roles.map((record) => ({
      role_name: record.roles.role_name,
      permissions: this.collectPermissionNames(record.roles.role_permissions),
      scope: globalScope,
    }));

    // All grants (active + pending) — exposed in authorization.grants.club_assignments
    const clubGrants = (user.club_role_assignments ?? [])
      .map((assignment) => this.buildClubGrant(assignment))
      .filter((assignment): assignment is ClubAuthorizationGrant =>
        Boolean(assignment),
      );

    // Only status:'active' grants are used for permission resolution and active context
    const activeClubGrants = clubGrants.filter(
      (grant) => grant.status === 'active',
    );

    const persistedActiveAssignmentId =
      user.users_pr?.active_club_assignment_id ?? null;
    const activeClubGrant =
      activeClubGrants.find(
        (assignment) =>
          assignment.assignment_id === persistedActiveAssignmentId,
      ) ??
      activeClubGrants[0] ??
      null;

    const globalPermissions = this.uniqueSorted(
      globalGrants.flatMap((grant) => grant.permissions),
    );
    const effectivePermissions = this.uniqueSorted([
      ...globalPermissions,
      ...(activeClubGrant?.permissions ?? []),
    ]);

    const activeLegacyContext = activeClubGrant
      ? this.toLegacyAssignmentContext(activeClubGrant)
      : null;

    const result: ResolvedAuthorizationProfile = {
      profile: {
        user_id: user.user_id,
        email: user.email,
        name: user.name,
        paternal_last_name: user.paternal_last_name,
        maternal_last_name: user.maternal_last_name,
        gender: user.gender,
        birthday: user.birthday,
        baptism: user.baptism,
        baptism_date: user.baptism_date,
        user_image: user.user_image,
        country_id: user.country_id,
        union_id: user.union_id,
        local_field_id: user.local_field_id,
        created_at: user.created_at,
      },
      post_register_complete: user.users_pr?.complete ?? false,
      authorization: {
        grants: {
          global_roles: globalGrants,
          club_assignments: clubGrants,
        },
        active_assignment: {
          assignment_id: activeClubGrant?.assignment_id ?? null,
        },
        effective: {
          permissions: effectivePermissions,
          scope: {
            global: globalScope,
            club: activeClubGrant
              ? {
                  assignment_id: activeClubGrant.assignment_id,
                  role_name: activeClubGrant.role_name,
                  club: activeClubGrant.club,
                  section: activeClubGrant.section,
                }
              : null,
          },
        },
      },
      legacy: {
        roles: globalGrants.map((grant) => grant.role_name),
        permissions: globalPermissions,
        club: activeClubGrant
          ? {
              club_id: activeClubGrant.club.club_id,
              club_name: activeClubGrant.club.club_name,
              club_type: activeClubGrant.section.club_type_name ?? null,
            }
          : null,
        club_context: {
          active_assignment_id: activeClubGrant?.assignment_id ?? null,
          active: activeLegacyContext,
          available: activeClubGrants.map((grant) =>
            this.toLegacyAssignmentContext(grant),
          ),
        },
      },
    };

    // ── Cache SET path ──────────────────────────────────────────────────────
    try {
      await this.cacheManager.set(cacheKey, result, AUTH_CONTEXT_TTL_MS);
      this.logger.debug(
        `Auth context cache SET  — ${cacheKey} (TTL ${AUTH_CONTEXT_TTL_MS}ms)`,
      );
    } catch (err) {
      // Redis down — return DB result without caching, degrade gracefully
      this.logger.warn(
        `Auth context cache SET fallido para "${cacheKey}": ${this.extractMessage(err)}`,
      );
    }

    return result;
  }

  async hasAnyGlobalRole(
    userId: string,
    roleNames: string[],
  ): Promise<boolean> {
    const normalizedRequired = new Set(
      roleNames.map((roleName) => roleName.toLowerCase()),
    );
    const resolved = await this.resolveUserAuthorization(userId);

    return resolved.authorization.grants.global_roles.some((grant) =>
      normalizedRequired.has(grant.role_name.toLowerCase()),
    );
  }

  async canManageClub(userId: string, clubId: number): Promise<boolean> {
    const [resolved, club] = await Promise.all([
      this.resolveUserAuthorization(userId),
      this.prisma.clubs.findUnique({
        where: { club_id: clubId },
        select: {
          local_field_id: true,
          local_fields: {
            select: {
              union_id: true,
            },
          },
        },
      }),
    ]);

    if (!club) {
      return false;
    }

    const roleNames = new Set(
      resolved.authorization.grants.global_roles.map((grant) =>
        grant.role_name.toLowerCase(),
      ),
    );
    const scope = resolved.authorization.effective.scope.global;
    const localFieldId = scope.local_field?.id;
    const unionId = scope.union?.id;

    if (roleNames.has('super_admin')) {
      return true;
    }

    const managesByLocalField =
      typeof localFieldId === 'number' &&
      localFieldId === club.local_field_id &&
      (roleNames.has('admin') ||
        roleNames.has('assistant_admin') ||
        roleNames.has('coordinator'));

    if (managesByLocalField) {
      return true;
    }

    return (
      typeof unionId === 'number' &&
      unionId === club.local_fields?.union_id &&
      (roleNames.has('admin') || roleNames.has('assistant_admin'))
    );
  }

  private buildUserScope(user: {
    countries?: { country_id: number; name: string | null } | null;
    unions?: { union_id: number; name: string | null } | null;
    local_fields?: { local_field_id: number; name: string | null } | null;
  }): AuthorizationTerritoryScope {
    const scope: AuthorizationTerritoryScope = {};

    if (user.countries?.country_id) {
      scope.country = {
        id: user.countries.country_id,
        name: user.countries.name,
      };
    }

    if (user.unions?.union_id) {
      scope.union = {
        id: user.unions.union_id,
        name: user.unions.name,
      };
    }

    if (user.local_fields?.local_field_id) {
      scope.local_field = {
        id: user.local_fields.local_field_id,
        name: user.local_fields.name,
      };
    }

    return scope;
  }

  private buildClubGrant(
    assignment: ClubAssignmentRecord,
  ): ClubAuthorizationGrant | null {
    const permissions = this.collectPermissionNames(
      assignment.roles.role_permissions,
    );

    if (assignment.club_sections?.clubs) {
      return {
        assignment_id: assignment.assignment_id,
        role_name: assignment.roles.role_name,
        permissions,
        club: {
          club_id: assignment.club_sections.clubs.club_id,
          club_name: assignment.club_sections.clubs.name ?? '',
        },
        section: {
          club_section_id: assignment.club_sections.club_section_id,
          club_type_name: assignment.club_sections.club_types?.name ?? null,
        },
        scope: this.buildClubScope(assignment.club_sections.clubs),
        status: assignment.status ?? 'active',
        start_date: assignment.start_date,
        end_date: assignment.end_date,
        expires_at: assignment.expires_at,
      };
    }

    return null;
  }

  private buildClubScope(
    club: ClubHierarchyRecord,
  ): AuthorizationTerritoryScope {
    const scope: AuthorizationTerritoryScope = {};
    const localField = club.local_fields;
    const union = localField?.unions;
    const country = union?.countries;

    if (country?.country_id) {
      scope.country = {
        id: country.country_id,
        name: country.name,
      };
    }

    if (union?.union_id) {
      scope.union = {
        id: union.union_id,
        name: union.name,
      };
    }

    if (localField?.local_field_id) {
      scope.local_field = {
        id: localField.local_field_id,
        name: localField.name,
      };
    }

    return scope;
  }

  private collectPermissionNames(records: RolePermissionRecord[]): string[] {
    return this.uniqueSorted(
      (records ?? [])
        .map((record) => record.permissions?.permission_name?.trim())
        .filter((permission): permission is string => Boolean(permission)),
    );
  }

  private uniqueSorted(values: string[]): string[] {
    return Array.from(new Set(values)).sort((left, right) =>
      left.localeCompare(right),
    );
  }

  private toLegacyAssignmentContext(
    assignment: ClubAuthorizationGrant,
  ): LegacyAssignmentContext {
    return {
      assignment_id: assignment.assignment_id,
      role_name: assignment.role_name,
      club_section_id: assignment.section.club_section_id,
      club_id: assignment.club.club_id,
      club_name: assignment.club.club_name,
      club_type: assignment.section.club_type_name ?? null,
    };
  }

  private extractMessage(err: unknown): string {
    return err instanceof Error ? err.message : String(err);
  }
}
