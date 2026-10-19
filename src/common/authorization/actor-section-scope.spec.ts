import { ErrorCode } from '../errors/error-codes';
import {
  ACTOR_FIXTURES,
  actorProfile,
  DIRECTOR_CLUB_PERMISSIONS,
} from '../testing/actor-scope.fixture';
import {
  activeMembershipInScopeWhere,
  buildActorSectionScope,
  clubSectionScopeWhere,
  isActorSectionScopeEmpty,
} from './actor-section-scope';

const REVIEW = { club: 'validation:review', global: 'validation:review' };
const REQUESTS_READ = { club: 'requests:review', global: 'requests:read' };

describe('buildActorSectionScope', () => {
  it('gives a member nothing: the base user role and member reads do not count', () => {
    const scope = buildActorSectionScope(ACTOR_FIXTURES.member(), REVIEW);
    expect(isActorSectionScopeEmpty(scope)).toBe(true);

    const requests = buildActorSectionScope(
      ACTOR_FIXTURES.member(),
      REQUESTS_READ,
    );
    expect(isActorSectionScopeEmpty(requests)).toBe(true);
  });

  it('limits a club director to the sections where the role carries the permission', () => {
    const profile = actorProfile({
      clubGrants: [
        {
          sectionId: 10,
          roleName: 'director',
          permissions: DIRECTOR_CLUB_PERMISSIONS,
        },
        {
          sectionId: 11,
          roleName: 'member',
          permissions: ['validation:read', 'requests:read'],
        },
        {
          sectionId: 12,
          roleName: 'director',
          permissions: DIRECTOR_CLUB_PERMISSIONS,
          operational: false,
        },
        {
          sectionId: 13,
          roleName: 'director',
          permissions: DIRECTOR_CLUB_PERMISSIONS,
          status: 'inactive',
        },
      ],
    });

    expect(buildActorSectionScope(profile, REVIEW)).toEqual({
      all: false,
      sectionIds: [10],
      clubs: null,
    });
  });

  it('scopes a local-field director to the clubs of the field', () => {
    expect(
      buildActorSectionScope(ACTOR_FIXTURES.localFieldDirector(), REVIEW),
    ).toEqual({ all: false, sectionIds: [], clubs: { local_field_id: 7 } });
  });

  it('scopes a union director to the clubs of the union', () => {
    expect(
      buildActorSectionScope(ACTOR_FIXTURES.unionDirector(), REVIEW),
    ).toEqual({
      all: false,
      sectionIds: [],
      clubs: { local_fields: { union_id: 3 } },
    });
  });

  it('adds coordinator sections only when a coordinator role carries the permission', () => {
    expect(
      buildActorSectionScope(ACTOR_FIXTURES.coordinator(), REVIEW, [30, 31]),
    ).toEqual({ all: false, sectionIds: [30, 31], clubs: null });
  });

  it('gives super-admin the whole system', () => {
    expect(buildActorSectionScope(ACTOR_FIXTURES.superAdmin(), REVIEW)).toEqual(
      { all: true },
    );
  });

  it('fails closed for an admin without a configured territory', () => {
    expect(() =>
      buildActorSectionScope(ACTOR_FIXTURES.adminWithoutTerritory(), REVIEW),
    ).toThrow(
      expect.objectContaining({ code: ErrorCode.ADMIN_USER_SCOPE_MISSING }),
    );
  });

  it.each([
    ['without territory', {}],
    ['with a configured territory', { local_field: { id: 7 } }],
  ])(
    'gives a direct permission no section scope (%s): scope comes only from roles',
    (_label, territory) => {
      const profile = actorProfile({ territory });
      profile.authorization.grants.direct_permissions = [
        'validation:review',
        'requests:review',
        'requests:read',
      ];

      expect(
        isActorSectionScopeEmpty(buildActorSectionScope(profile, REVIEW)),
      ).toBe(true);
      expect(
        isActorSectionScopeEmpty(
          buildActorSectionScope(profile, REQUESTS_READ),
        ),
      ).toBe(true);
    },
  );

  it('does not let a direct permission unlock the territory of a role that lacks it', () => {
    const profile = actorProfile({
      globalRoles: [{ roleName: 'director-lf', permissions: [] }],
      territory: { local_field: { id: 7 } },
    });
    profile.authorization.grants.direct_permissions = ['validation:review'];

    expect(
      isActorSectionScopeEmpty(buildActorSectionScope(profile, REVIEW)),
    ).toBe(true);
  });

  it('ignores territory when no global role carries the permission', () => {
    const profile = actorProfile({
      globalRoles: [
        { roleName: 'director-lf', permissions: ['requests:read'] },
      ],
      territory: { local_field: { id: 7 } },
    });

    expect(
      isActorSectionScopeEmpty(buildActorSectionScope(profile, REVIEW)),
    ).toBe(true);
  });
});

describe('scope where builders', () => {
  it('matches nothing for an empty scope', () => {
    const empty = { all: false as const, sectionIds: [], clubs: null };
    expect(clubSectionScopeWhere(empty)).toEqual({
      club_section_id: { in: [] },
    });
  });

  it('combines sections and territory with OR', () => {
    expect(
      clubSectionScopeWhere({
        all: false,
        sectionIds: [10],
        clubs: { local_field_id: 7 },
      }),
    ).toEqual({
      OR: [
        { club_section_id: { in: [10] } },
        { clubs: { is: { local_field_id: 7 } } },
      ],
    });
  });

  it('builds the active membership filter with an optional section', () => {
    expect(
      activeMembershipInScopeWhere(
        { all: false, sectionIds: [10], clubs: null },
        10,
      ),
    ).toEqual({
      active: true,
      status: 'active',
      club_section_id: 10,
      club_sections: { is: { club_section_id: { in: [10] } } },
    });
    expect(activeMembershipInScopeWhere({ all: true })).toEqual({
      active: true,
      status: 'active',
    });
  });
});
