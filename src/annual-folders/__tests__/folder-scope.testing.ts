import {
  actorCanAccessHierarchyScope,
  resolveActorTerritoryScope,
} from '../../common/authorization/actor-territory-scope';

type TerritoryIds = {
  division?: number;
  union?: number;
  localField?: number;
};

/**
 * Minimal resolved profile: only the slice read by `ActorScope.from` /
 * `resolveActorTerritoryScope` (global roles + global territory ids).
 */
export const buildResolvedProfile = (
  roleName: string | null,
  ids: TerritoryIds = {},
): any => ({
  profile: { user_id: 'actor-1' },
  authorization: {
    grants: {
      global_roles: roleName ? [{ role_name: roleName }] : [],
      club_assignments: [],
    },
    effective: {
      scope: {
        global: {
          ...(ids.division ? { division: { id: ids.division } } : {}),
          ...(ids.union ? { union: { id: ids.union } } : {}),
          ...(ids.localField ? { local_field: { id: ids.localField } } : {}),
        },
      },
    },
  },
});

/**
 * AuthorizationContextService double that keeps the REAL territory logic
 * (role-first tier + hierarchy match) and only fakes profile resolution.
 */
export const buildScopedAuthorizationContext = (resolved: unknown) => ({
  resolveUserAuthorization: jest.fn().mockResolvedValue(resolved),
  canAccessHierarchyScope: jest.fn(
    (
      profile: any,
      scope: {
        division_id?: number | null;
        union_id?: number | null;
        local_field_id?: number | null;
      },
    ) =>
      actorCanAccessHierarchyScope(resolveActorTerritoryScope(profile), scope),
  ),
});
