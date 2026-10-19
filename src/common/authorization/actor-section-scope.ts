import type { Prisma } from '@prisma/client';
import { AppForbiddenException } from '../errors/app.exception';
import { ErrorCode } from '../errors/error-codes';
import { BASE_GLOBAL_ROLE_NAME } from '../guards/permissions.guard';
import type { ResolvedAuthorizationProfile } from '../services/authorization-context.service';
import {
  clubsWhereForActor,
  hasTerritorialRecorte,
  resolveActorTerritoryScope,
} from './actor-territory-scope';

export const COORDINATOR_ROLE_NAMES = new Set([
  'coordinator',
  'zone-coordinator',
  'general-coordinator',
]);

/**
 * Club sections an actor may work on for one capability (review honors,
 * manage role/transfer requests...). `all` only for an unrestricted territory
 * (super-admin); otherwise the union of:
 * - the actor's territory (division / union / local field, role-first), when
 *   a global role carries `permissions.global`;
 * - coordinator-assigned sections, when a coordinator role carries it;
 * - sections of operational club assignments that carry `permissions.club`.
 * An empty scope means the actor is not a reviewer anywhere.
 */
export type ActorSectionScope =
  | { all: true }
  | {
      all: false;
      sectionIds: number[];
      clubs: Prisma.clubsWhereInput | null;
    };

export type ActorSectionScopePermissions = {
  /** Permission an operational club assignment must carry. */
  club: string;
  /** Permission a territorial/admin/coordinator global role must carry. */
  global: string;
};

type GlobalGrant =
  ResolvedAuthorizationProfile['authorization']['grants']['global_roles'][number];

function nonBaseGlobalGrants(
  resolved: ResolvedAuthorizationProfile,
): GlobalGrant[] {
  return resolved.authorization.grants.global_roles.filter(
    (grant) => grant.role_name.toLowerCase() !== BASE_GLOBAL_ROLE_NAME,
  );
}

/** A non-base global role (or a direct grant) carries `permission`. */
export function actorHasGlobalPermission(
  resolved: ResolvedAuthorizationProfile,
  permission: string,
): boolean {
  return (
    nonBaseGlobalGrants(resolved).some((grant) =>
      grant.permissions.includes(permission),
    ) ||
    (resolved.authorization.grants.direct_permissions ?? []).includes(
      permission,
    )
  );
}

/** A coordinator role carries `permission`, so its sections count. */
export function actorHasCoordinatorPermission(
  resolved: ResolvedAuthorizationProfile,
  permission: string,
): boolean {
  return resolved.authorization.grants.global_roles.some(
    (grant) =>
      COORDINATOR_ROLE_NAMES.has(grant.role_name.toLowerCase()) &&
      grant.permissions.includes(permission),
  );
}

/** Sections of operational club assignments that carry `permission`. */
export function clubSectionIdsWithPermission(
  resolved: ResolvedAuthorizationProfile,
  permission: string,
): number[] {
  return resolved.authorization.grants.club_assignments
    .filter(
      (grant) =>
        grant.status === 'active' &&
        grant.operational !== false &&
        (grant.permissions ?? []).includes(permission),
    )
    .map((grant) => grant.section.club_section_id);
}

export function buildActorSectionScope(
  resolved: ResolvedAuthorizationProfile,
  permissions: ActorSectionScopePermissions,
  coordinatorSectionIds: number[] = [],
): ActorSectionScope {
  let clubs: Prisma.clubsWhereInput | null = null;

  if (actorHasGlobalPermission(resolved, permissions.global)) {
    const territory = resolveActorTerritoryScope(resolved);
    if (territory.level === 'all') {
      return { all: true };
    }
    if (territory.level === 'unconfigured') {
      throw new AppForbiddenException(ErrorCode.ADMIN_USER_SCOPE_MISSING);
    }
    if (hasTerritorialRecorte(territory)) {
      clubs = clubsWhereForActor(territory);
    }
  }

  const sectionIds = [
    ...new Set([
      ...coordinatorSectionIds,
      ...clubSectionIdsWithPermission(resolved, permissions.club),
    ]),
  ].sort((a, b) => a - b);

  return { all: false, sectionIds, clubs };
}

export function isActorSectionScopeEmpty(scope: ActorSectionScope): boolean {
  return !scope.all && scope.sectionIds.length === 0 && scope.clubs === null;
}

/** `club_sections` filter for the scope. Empty scope matches nothing. */
export function clubSectionScopeWhere(
  scope: ActorSectionScope,
): Prisma.club_sectionsWhereInput {
  if (scope.all) {
    return {};
  }

  const branches: Prisma.club_sectionsWhereInput[] = [];
  if (scope.sectionIds.length > 0) {
    branches.push({ club_section_id: { in: scope.sectionIds } });
  }
  if (scope.clubs) {
    branches.push({ clubs: { is: scope.clubs } });
  }

  if (branches.length === 0) {
    return { club_section_id: { in: [] } };
  }

  return branches.length === 1 ? branches[0] : { OR: branches };
}

/** Active club membership of a user inside the scope. */
export function activeMembershipInScopeWhere(
  scope: ActorSectionScope,
  clubSectionId?: number,
): Prisma.club_role_assignmentsWhereInput {
  return {
    active: true,
    status: 'active',
    ...(clubSectionId !== undefined ? { club_section_id: clubSectionId } : {}),
    ...(scope.all
      ? {}
      : { club_sections: { is: clubSectionScopeWhere(scope) } }),
  };
}
