import { hasClubRole, isSectionDirector, rolesInclude } from './role-checks';

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
});
