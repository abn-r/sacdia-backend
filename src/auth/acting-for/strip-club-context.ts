import type { ResolvedAuthorizationProfile } from '../../common/services/authorization-context.service';

const uniqueSorted = (values: string[]): string[] =>
  [...new Set(values)].sort((a, b) => a.localeCompare(b));

/**
 * The resolved authorization WITHOUT any club context, for a principal that
 * `principalSeesClubData()` rejects (a teen without a verified guardian, an
 * unknown-age account), also when it holds an active club assignment from
 * before Phase 3.
 *
 * It keeps the exact shape the app parses (empty lists and nulls, never a
 * missing block) and drops everything that names or derives from a club: the
 * club assignments, the active assignment, the effective club scope, the legacy
 * club and club_context, and the permissions the club role added. Global roles,
 * direct permissions and the profile are untouched.
 *
 * Pure: the input may be the shared authorization-cache entry, so it is never
 * mutated.
 */
export function stripClubContext(
  resolved: ResolvedAuthorizationProfile,
): ResolvedAuthorizationProfile {
  const { grants, effective } = resolved.authorization;
  const directPermissions = grants.direct_permissions ?? [];
  const globalPermissions = grants.global_roles.flatMap(
    (grant) => grant.permissions,
  );

  return {
    ...resolved,
    authorization: {
      grants: {
        ...grants,
        club_assignments: [],
        direct_permissions: directPermissions,
      },
      active_assignment: { assignment_id: null },
      effective: {
        ...effective,
        permissions: uniqueSorted([...globalPermissions, ...directPermissions]),
        scope: { ...effective.scope, club: null },
      },
    },
    legacy: {
      ...resolved.legacy,
      club: null,
      club_context: {
        active_assignment_id: null,
        active: null,
        available: [],
      },
    },
  };
}
