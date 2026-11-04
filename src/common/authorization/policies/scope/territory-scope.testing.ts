import type { PolicyContext } from '../resource-policy';

/** Shared builders for the camporee policy specs. */
export const buildResolved = (): any => ({
  authorization: {
    active_assignment: { assignment_id: null },
    grants: { club_assignments: [], global_roles: [] },
    effective: { scope: { global: {}, club: null } },
  },
});

export const buildHierarchy = () =>
  ({
    resolveCurrent: jest.fn().mockResolvedValue({
      division_id: 1,
      union_id: 2,
      local_field_id: 3,
    }),
  }) as any;

export const buildAuthorizationContext = (canAccess: boolean) =>
  ({
    canAccessHierarchyScope: jest.fn().mockReturnValue(canAccess),
  }) as any;

export const buildCtx = (
  resource: PolicyContext['resource'],
  request: any,
): PolicyContext => ({
  userId: 'user-1',
  request,
  resolved: buildResolved(),
  requirement: { permissions: ['x:y'], mode: 'all' },
  resource,
});

export const camporeeRow = {
  local_field_id: 3,
  local_fields: { union_id: 2, unions: { country_id: 9 } },
};
export const unionRow = { union_id: 2, unions: { country_id: 9 } };
