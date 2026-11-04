import type { ResolvedAuthorizationProfile } from '../services/authorization-context.service';
import { actorProfile } from '../testing/actor-scope.fixture';
import { ActorScope } from './actor-scope';

function withActiveClub(
  profile: ResolvedAuthorizationProfile,
  activeLocalFieldId?: number,
): ResolvedAuthorizationProfile {
  const { authorization } = profile;
  return {
    ...profile,
    authorization: {
      ...authorization,
      grants: {
        ...authorization.grants,
        club_assignments: authorization.grants.club_assignments.map(
          (grant) => ({
            ...grant,
            scope:
              activeLocalFieldId === undefined
                ? grant.scope
                : { local_field: { id: activeLocalFieldId } },
          }),
        ),
      },
      active_assignment: { assignment_id: 'assignment-1' },
      effective: {
        ...authorization.effective,
        scope: {
          ...authorization.effective.scope,
          club: {
            assignment_id: 'assignment-1',
            role_name: 'director',
            club: { club_id: 55, club_name: 'Club' },
            section: { club_section_id: 10, club_type_id: 2 },
          },
        },
      },
    },
  };
}

describe('ActorScope', () => {
  const territorial = actorProfile({
    userId: 'u-1',
    globalRoles: [
      { roleName: 'Director-LF', permissions: [] },
      { roleName: 'admin', permissions: [] },
    ],
    territory: {
      division: { id: 1 },
      union: { id: 3 },
      local_field: { id: 7 },
      country: { id: 9 },
    },
  });

  it('reads identity and territory from the global scope', () => {
    const actor = ActorScope.from(territorial);
    expect(actor.userId).toBe('u-1');
    expect(actor.divisionId).toBe(1);
    expect(actor.unionId).toBe(3);
    expect(actor.localFieldId).toBe(7);
    expect(actor.countryId).toBe(9);
    expect(actor.activeClubId).toBeUndefined();
    expect(actor.activeSectionId).toBeUndefined();
    expect(actor.activeLocalFieldId).toBeUndefined();
    expect(actor.coordinatorSectionIds).toEqual([]);
  });

  it('ignores non-numeric scope ids', () => {
    const actor = ActorScope.from(
      actorProfile({ territory: { union: { id: 'x' } } }),
    );
    expect(actor.unionId).toBeUndefined();
  });

  it('matches roles case-insensitively, any-of', () => {
    const actor = ActorScope.from(territorial);
    expect(actor.globalRoles.has('director-lf')).toBe(true);
    expect(actor.hasRole('admin')).toBe(true);
    expect(actor.hasRole('super-admin', 'ADMIN')).toBe(true);
    expect(actor.hasRole('super-admin')).toBe(false);
    expect(actor.hasRole()).toBe(false);
    expect(actor.hasAnyRole(new Set(['coordinator', 'director-lf']))).toBe(
      true,
    );
    expect(actor.hasAnyRole([])).toBe(false);
  });

  it('builds a role-only actor from a normalised list', () => {
    const actor = ActorScope.fromRoleNames(['Admin'], 'u-2');
    expect(actor.userId).toBe('u-2');
    expect(actor.hasRole('admin')).toBe(true);
    expect(actor.hasRole('super-admin')).toBe(false);
    expect(() =>
      actor.coversHierarchy({}, { canAccessHierarchyScope: jest.fn() }),
    ).toThrow();
  });

  it('reads the active club and its local field from the active assignment', () => {
    const profile = withActiveClub(
      actorProfile({
        clubGrants: [{ sectionId: 10, roleName: 'director', permissions: [] }],
      }),
      21,
    );
    const actor = ActorScope.from(profile);
    expect(actor.activeClubId).toBe(55);
    expect(actor.activeSectionId).toBe(10);
    expect(actor.activeLocalFieldId).toBe(21);
  });

  it('covers sections by active section or coordinator assignment', () => {
    const profile = withActiveClub(
      actorProfile({
        clubGrants: [{ sectionId: 10, roleName: 'director', permissions: [] }],
      }),
    );
    const actor = ActorScope.from(profile, { coordinatorSectionIds: [40, 41] });
    expect(actor.coversSection(10)).toBe(true);
    expect(actor.coversSection(41)).toBe(true);
    expect(actor.coversSection(99)).toBe(false);
    expect(ActorScope.from(territorial).coversSection(10)).toBe(false);
  });

  it('covers local fields by global or active-grant local field', () => {
    expect(ActorScope.from(territorial).coversLocalField(7)).toBe(true);
    expect(ActorScope.from(territorial).coversLocalField(8)).toBe(false);
    const clubOnly = ActorScope.from(
      withActiveClub(
        actorProfile({
          clubGrants: [
            { sectionId: 10, roleName: 'director', permissions: [] },
          ],
        }),
        21,
      ),
    );
    expect(clubOnly.coversLocalField(21)).toBe(true);
    expect(clubOnly.coversLocalField(7)).toBe(false);
  });

  it('delegates hierarchy and club coverage to the authorization context', async () => {
    const canAccessHierarchyScope = jest.fn().mockReturnValue(true);
    const canManageClub = jest.fn().mockResolvedValue(true);
    const actor = ActorScope.from(territorial);
    const node = { union_id: 3 };

    expect(
      actor.coversHierarchy(
        node,
        { canAccessHierarchyScope },
        'historical-read',
      ),
    ).toBe(true);
    expect(canAccessHierarchyScope).toHaveBeenCalledWith(
      territorial,
      node,
      'historical-read',
    );
    await expect(actor.coversClub(5, { canManageClub })).resolves.toBe(true);
    expect(canManageClub).toHaveBeenCalledWith('u-1', 5, territorial);
  });
});
