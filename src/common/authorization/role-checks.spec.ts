import type { AuthorizationSnapshot } from '../services/authorization-context.service';
import {
  hasClubRole,
  isSectionDirector,
  isSuperAdminSnapshot,
  rolesInclude,
} from './role-checks';

function snapshotWith(...roleNames: string[]): AuthorizationSnapshot {
  return {
    grants: {
      global_roles: roleNames.map((role_name) => ({
        role_name,
        permissions: [],
        scope: {},
      })),
      club_assignments: [],
      direct_permissions: [],
    },
  } as unknown as AuthorizationSnapshot;
}

describe('role-checks', () => {
  it('isSectionDirector is case-insensitive and null-safe', () => {
    expect(isSectionDirector({ role_name: 'director' })).toBe(true);
    expect(isSectionDirector({ role_name: 'Director' })).toBe(true);
    expect(isSectionDirector({ role_name: 'deputy-director' })).toBe(false);
    expect(isSectionDirector(null)).toBe(false);
    expect(isSectionDirector(undefined)).toBe(false);
  });

  it('hasClubRole matches any listed role', () => {
    expect(
      hasClubRole({ role_name: 'Treasurer' }, 'secretary', 'treasurer'),
    ).toBe(true);
    expect(hasClubRole({ role_name: 'member' }, 'director')).toBe(false);
    expect(hasClubRole(null, 'director')).toBe(false);
  });

  it('rolesInclude works on any iterable', () => {
    expect(rolesInclude(new Set(['admin', 'user']), 'pastor', 'user')).toBe(
      true,
    );
    expect(rolesInclude(['admin'], 'pastor')).toBe(false);
    expect(rolesInclude([], 'pastor')).toBe(false);
  });

  describe('isSuperAdminSnapshot', () => {
    it('is true for a super-admin grant', () => {
      expect(isSuperAdminSnapshot(snapshotWith('super-admin'))).toBe(true);
      expect(isSuperAdminSnapshot(snapshotWith('admin', 'super-admin'))).toBe(
        true,
      );
    });

    it('normalizes padding and case', () => {
      expect(isSuperAdminSnapshot(snapshotWith(' Super-Admin '))).toBe(true);
    });

    it('is false for an admin without super-admin', () => {
      expect(isSuperAdminSnapshot(snapshotWith('admin'))).toBe(false);
      expect(isSuperAdminSnapshot(snapshotWith('director-lf'))).toBe(false);
    });

    it('is false without grants', () => {
      expect(isSuperAdminSnapshot(snapshotWith())).toBe(false);
      expect(
        isSuperAdminSnapshot({
          grants: {},
        } as unknown as AuthorizationSnapshot),
      ).toBe(false);
      expect(isSuperAdminSnapshot({} as AuthorizationSnapshot)).toBe(false);
    });

    it('is false for null and undefined', () => {
      expect(isSuperAdminSnapshot(null)).toBe(false);
      expect(isSuperAdminSnapshot(undefined)).toBe(false);
    });
  });
});
