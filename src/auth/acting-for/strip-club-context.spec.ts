import type { ResolvedAuthorizationProfile } from '../../common/services/authorization-context.service';
import { stripClubContext } from './strip-club-context';

const clubGrant = {
  assignment_id: 'assign-1',
  role_name: 'member',
  permissions: ['club_members:read', 'classes:read'],
  operational: true,
  ecclesiastical_year_id: 7,
  club: { club_id: 10, club_name: 'Club Aguila' },
  section: { club_section_id: 20, club_type_id: 2, club_type_name: 'Pathfinder' },
  scope: {},
  status: 'active',
};

const resolved = (): ResolvedAuthorizationProfile =>
  ({
    profile: { user_id: 'teen-1', name: 'Ana' },
    post_register_complete: true,
    authorization: {
      grants: {
        global_roles: [
          { role_name: 'user', permissions: ['catalogs:read'], scope: {} },
        ],
        club_assignments: [clubGrant],
        direct_permissions: ['extra:read'],
      },
      active_assignment: { assignment_id: 'assign-1' },
      effective: {
        permissions: [
          'catalogs:read',
          'classes:read',
          'club_members:read',
          'extra:read',
        ],
        scope: {
          global: {},
          club: {
            assignment_id: 'assign-1',
            role_name: 'member',
            club: clubGrant.club,
            section: clubGrant.section,
          },
        },
      },
    },
    legacy: {
      roles: ['user'],
      permissions: ['catalogs:read', 'extra:read'],
      club: { club_id: 10, club_name: 'Club Aguila', club_type: 'Pathfinder' },
      club_context: {
        active_assignment_id: 'assign-1',
        active: { assignment_id: 'assign-1', club_name: 'Club Aguila' },
        available: [{ assignment_id: 'assign-1', club_name: 'Club Aguila' }],
      },
    },
  }) as unknown as ResolvedAuthorizationProfile;

describe('stripClubContext', () => {
  it('empties every club-context field and keeps the structure the app parses', () => {
    const out = stripClubContext(resolved());

    expect(out.authorization.grants.club_assignments).toEqual([]);
    expect(out.authorization.grants.global_roles).toHaveLength(1);
    expect(out.authorization.grants.direct_permissions).toEqual(['extra:read']);
    expect(out.authorization.active_assignment).toEqual({
      assignment_id: null,
    });
    expect(out.authorization.effective.scope.club).toBeNull();
    expect(out.authorization.effective.scope.global).toEqual({});
    expect(out.legacy.club).toBeNull();
    expect(out.legacy.club_context).toEqual({
      active_assignment_id: null,
      active: null,
      available: [],
    });
    expect(out.legacy.roles).toEqual(['user']);
    expect(out.legacy.permissions).toEqual(['catalogs:read', 'extra:read']);
    expect(out.profile).toEqual({ user_id: 'teen-1', name: 'Ana' });
    expect(out.post_register_complete).toBe(true);
  });

  it('drops the permissions the club role added, keeping global and direct ones', () => {
    const out = stripClubContext(resolved());
    expect(out.authorization.effective.permissions).toEqual([
      'catalogs:read',
      'extra:read',
    ]);
  });

  it('leaves no club name anywhere in the output', () => {
    expect(JSON.stringify(stripClubContext(resolved()))).not.toContain(
      'Club Aguila',
    );
  });

  it('does not mutate its input (the authorization cache may share the object)', () => {
    const input = resolved();
    const snapshot = JSON.stringify(input);
    stripClubContext(input);
    expect(JSON.stringify(input)).toBe(snapshot);
  });
});
