import type { Prisma } from '@prisma/client';
import type { PrismaService } from '../../prisma/prisma.service';
import type { ResolvedAuthorizationProfile } from '../services/authorization-context.service';
import {
  type ActorTerritoryScope,
  resolveActorTerritoryScope,
  toTerritoryId,
  usersWhereForActor,
} from './actor-territory-scope';
import {
  coordinatorRolePermissions,
  coordinatorScopeIncludesSection,
} from './coordinator-section-scope';
import type { MemberTerritoryScopeService } from './member-territory-scope.service';

/** Effective club assignment when no MemberTerritoryScopeService is wired. */
const ACTIVE_ASSIGNMENT: Prisma.club_role_assignmentsWhereInput = {
  active: true,
  status: 'active',
};

type TargetUserScopePrisma = Pick<
  PrismaService,
  | 'users'
  | 'club_role_assignments'
  | 'coordinator_assignments'
  | 'club_sections'
  | 'coordination_zone_districts'
>;

/**
 * Whether a global-role actor may act on `targetUserId` through a `user`
 * resource route (`/users/:userId/...`). The permission alone says what the
 * actor may do, not on whom: the target must sit inside the actor's
 * territory, the same rule `GET /admin/users/:userId` applies.
 *
 * - super-admin: anyone.
 * - admin / lf / union / dia: members of their territory (own user row or an
 *   effective club role there), via `usersWhereForActor`.
 * - pastor: the local field of their global scope.
 * - coordinators: members of the sections their assignments cover.
 * Anything else, or a territorial role without territory: no.
 */
export async function isTargetUserInActorScope(
  deps: {
    prisma: TargetUserScopePrisma;
    memberScope?: Pick<
      MemberTerritoryScopeService,
      'effectiveAssignmentForScope'
    >;
  },
  actorUserId: string,
  resolved: ResolvedAuthorizationProfile,
  targetUserId: string,
): Promise<boolean> {
  const territory = territoryForTarget(resolved);

  if (territory?.level === 'all') {
    return true;
  }

  if (
    territory &&
    (territory.level === 'local_field' ||
      territory.level === 'union' ||
      territory.level === 'division')
  ) {
    const effective = deps.memberScope
      ? await deps.memberScope.effectiveAssignmentForScope(territory)
      : ACTIVE_ASSIGNMENT;
    const inTerritory = await deps.prisma.users.count({
      where: {
        AND: [
          { user_id: targetUserId },
          usersWhereForActor(territory, effective),
        ],
      },
    });
    if (inTerritory > 0) {
      return true;
    }
  }

  const isCoordinator =
    coordinatorRolePermissions(resolved.authorization.grants.global_roles)
      .size > 0;
  if (isCoordinator) {
    // Same rule the guard applies to section resources: one of the target's
    // sections is covered by the coordinator's active assignments.
    const targetSections = await deps.prisma.club_role_assignments.findMany({
      where: { user_id: targetUserId, ...ACTIVE_ASSIGNMENT },
      select: { club_section_id: true },
      distinct: ['club_section_id'],
    });
    for (const { club_section_id } of targetSections) {
      if (
        club_section_id !== null &&
        (await coordinatorScopeIncludesSection(
          deps.prisma,
          actorUserId,
          club_section_id,
        ))
      ) {
        return true;
      }
    }
  }

  return false;
}

/**
 * The actor's territory for a target check. Pastors carry no territorial
 * role, so their global local field stands in (AdminUsersService does the
 * same). `null` = no territory path.
 */
function territoryForTarget(
  resolved: ResolvedAuthorizationProfile,
): ActorTerritoryScope | null {
  const scope = resolveActorTerritoryScope(resolved);
  if (scope.level !== 'open' && scope.level !== 'unconfigured') {
    return scope;
  }

  const isPastor = resolved.authorization.grants.global_roles.some(
    (grant) => grant.role_name.trim().toLowerCase() === 'pastor',
  );
  const localFieldId = toTerritoryId(
    resolved.authorization.effective.scope.global.local_field?.id,
  );
  if (isPastor && localFieldId) {
    return { level: 'local_field', localFieldId };
  }
  return null;
}
