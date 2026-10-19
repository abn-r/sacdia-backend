import type {
  AuthorizationTerritoryScope,
  ResolvedAuthorizationProfile,
} from '../services/authorization-context.service';

/**
 * Minimal authorization profiles for scope tests. Only the fields the
 * section-scope helpers read are filled in.
 */
export type ActorFixtureClubGrant = {
  sectionId: number;
  roleName: string;
  permissions: string[];
  operational?: boolean;
  status?: string;
};

export type ActorFixtureGlobalRole = {
  roleName: string;
  permissions: string[];
};

export function actorProfile(params: {
  userId?: string;
  globalRoles?: ActorFixtureGlobalRole[];
  clubGrants?: ActorFixtureClubGrant[];
  territory?: AuthorizationTerritoryScope;
}): ResolvedAuthorizationProfile {
  const territory = params.territory ?? {};
  return {
    profile: { user_id: params.userId ?? 'actor-1' },
    authorization: {
      grants: {
        global_roles: [
          {
            role_name: 'user',
            permissions: ['validation:read', 'requests:read'],
            scope: territory,
          },
          ...(params.globalRoles ?? []).map((role) => ({
            role_name: role.roleName,
            permissions: role.permissions,
            scope: territory,
          })),
        ],
        club_assignments: (params.clubGrants ?? []).map((grant, index) => ({
          assignment_id: `assignment-${index + 1}`,
          role_name: grant.roleName,
          permissions: grant.permissions,
          operational: grant.operational ?? true,
          ecclesiastical_year_id: 2026,
          club: { club_id: 100 + grant.sectionId, club_name: 'Club' },
          section: { club_section_id: grant.sectionId, club_type_id: 2 },
          scope: territory,
          status: grant.status ?? 'active',
        })),
        direct_permissions: [],
      },
      active_assignment: { assignment_id: null },
      effective: {
        permissions: [],
        scope: { global: territory, club: null },
      },
    },
  } as unknown as ResolvedAuthorizationProfile;
}

/** Club roles as seeded: `member` reads only, staff reviews. */
export const MEMBER_CLUB_PERMISSIONS = [
  'validation:read',
  'validation:submit',
  'requests:read',
];
export const DIRECTOR_CLUB_PERMISSIONS = [
  'validation:read',
  'validation:submit',
  'validation:review',
  'requests:read',
  'requests:review',
];
export const TERRITORIAL_PERMISSIONS = [
  'validation:read',
  'validation:review',
  'requests:read',
  'requests:review',
];
export const COORDINATOR_PERMISSIONS = [
  'validation:read',
  'validation:review',
  'requests:read',
];

export const ACTOR_FIXTURES = {
  member: () =>
    actorProfile({
      userId: 'member-1',
      clubGrants: [
        {
          sectionId: 10,
          roleName: 'member',
          permissions: MEMBER_CLUB_PERMISSIONS,
        },
      ],
    }),
  clubDirector: () =>
    actorProfile({
      userId: 'director-1',
      clubGrants: [
        {
          sectionId: 10,
          roleName: 'director',
          permissions: DIRECTOR_CLUB_PERMISSIONS,
        },
      ],
    }),
  localFieldDirector: () =>
    actorProfile({
      userId: 'director-lf-1',
      globalRoles: [
        { roleName: 'director-lf', permissions: TERRITORIAL_PERMISSIONS },
      ],
      territory: {
        local_field: { id: 7 },
        union: { id: 3 },
        division: { id: 1 },
      },
    }),
  unionDirector: () =>
    actorProfile({
      userId: 'director-union-1',
      globalRoles: [
        { roleName: 'director-union', permissions: TERRITORIAL_PERMISSIONS },
      ],
      territory: { union: { id: 3 }, division: { id: 1 } },
    }),
  coordinator: () =>
    actorProfile({
      userId: 'coordinator-1',
      globalRoles: [
        { roleName: 'coordinator', permissions: COORDINATOR_PERMISSIONS },
      ],
    }),
  superAdmin: () =>
    actorProfile({
      userId: 'super-admin-1',
      globalRoles: [
        { roleName: 'super-admin', permissions: TERRITORIAL_PERMISSIONS },
      ],
    }),
  adminWithoutTerritory: () =>
    actorProfile({
      userId: 'admin-1',
      globalRoles: [
        { roleName: 'admin', permissions: TERRITORIAL_PERMISSIONS },
      ],
    }),
};
