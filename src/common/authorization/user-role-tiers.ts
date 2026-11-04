import type { GlobalRoleName } from './generated/role-names';
import { GlobalRole } from './roles';

/**
 * Global-role tiers for user creation (Adventist club authority chain). Pure
 * data + a pure resolver, shared by `AdminUsersService` (creation checks, the
 * bulk template) and `capabilities.ts` (`assignable_global_roles` in
 * `GET /auth/me`).
 *
 * Hierarchy rule:
 *   - super-admin → can create any role, including admin
 *   - admin → can create everything BELOW admin (NOT admin itself; only
 *     super-admin assigns admin); admin assigns director-dia
 *   - director-dia / assistant-dia → assigns UNION roles + below (NOT DIA roles)
 *   - director-union / assistant-union → assigns LF roles + below (NOT UNION roles)
 *   - director-lf / assistant-lf → assigns base roles only (NOT LF roles).
 *     Reason: LF directors are appointed by the union; the LF tier cannot
 *     self-assign or grow its own tier.
 */

/** T5 (base) = user, coordinator, zone-coordinator, general-coordinator, pastor */
export const BASE_T5_ROLES: readonly GlobalRoleName[] = [
  GlobalRole.USER,
  GlobalRole.COORDINATOR,
  GlobalRole.ZONE_COORDINATOR,
  GlobalRole.GENERAL_COORDINATOR,
  GlobalRole.PASTOR,
];

export const LF_TIER_ROLES: readonly GlobalRoleName[] = [
  GlobalRole.ASSISTANT_LF,
  GlobalRole.DIRECTOR_LF,
];

export const UNION_TIER_ROLES: readonly GlobalRoleName[] = [
  GlobalRole.ASSISTANT_UNION,
  GlobalRole.DIRECTOR_UNION,
];

export const DIA_TIER_ROLES: readonly GlobalRoleName[] = [
  GlobalRole.ASSISTANT_DIA,
  GlobalRole.DIRECTOR_DIA,
];

export type RoleTier = {
  actorRoles: readonly GlobalRoleName[];
  allowedTargetRoles: readonly GlobalRoleName[];
};

/**
 * Ordered from the highest tier (super-admin) to the lowest (local field).
 * `resolveAllowedTargetRoles` picks the first tier the actor belongs to.
 */
export const ROLE_HIERARCHY: readonly RoleTier[] = [
  {
    // super-admin can create any role (the DTO already blocks super-admin creation)
    actorRoles: [GlobalRole.SUPER_ADMIN],
    allowedTargetRoles: [
      ...BASE_T5_ROLES,
      ...LF_TIER_ROLES,
      ...UNION_TIER_ROLES,
      ...DIA_TIER_ROLES,
      GlobalRole.ADMIN,
    ],
  },
  {
    // admin assigns down to director-dia, but NOT admin itself
    actorRoles: [GlobalRole.ADMIN],
    allowedTargetRoles: [
      ...BASE_T5_ROLES,
      ...LF_TIER_ROLES,
      ...UNION_TIER_ROLES,
      ...DIA_TIER_ROLES,
    ],
  },
  {
    // DIA assigns down to UNION, NOT DIA peers
    actorRoles: [GlobalRole.DIRECTOR_DIA, GlobalRole.ASSISTANT_DIA],
    allowedTargetRoles: [
      ...BASE_T5_ROLES,
      ...LF_TIER_ROLES,
      ...UNION_TIER_ROLES,
    ],
  },
  {
    // UNION assigns down to LF, NOT UNION peers
    actorRoles: [GlobalRole.DIRECTOR_UNION, GlobalRole.ASSISTANT_UNION],
    allowedTargetRoles: [...BASE_T5_ROLES, ...LF_TIER_ROLES],
  },
  {
    // LF assigns only T5 base roles. Cannot grow its own tier.
    actorRoles: [GlobalRole.DIRECTOR_LF, GlobalRole.ASSISTANT_LF],
    allowedTargetRoles: [...BASE_T5_ROLES],
  },
];

/**
 * Full list of target roles an actor (by their global role names) may create,
 * in tier order. Picks the HIGHEST tier the actor belongs to so a director-dia
 * who also holds user/coordinator still benefits from the dia scope. `[]` when
 * the actor is in no recognised admin tier.
 */
export function resolveAllowedTargetRoles(
  actorRoles: Iterable<string>,
): string[] {
  const roles = new Set(actorRoles);
  for (const tier of ROLE_HIERARCHY) {
    if (tier.actorRoles.some((role) => roles.has(role))) {
      return [...tier.allowedTargetRoles];
    }
  }
  return [];
}
