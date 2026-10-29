import { directivaRoleLabel } from './club-directiva-roles';

describe('directivaRoleLabel', () => {
  it.each([
    ['director', 'Director'],
    ['deputy-director', 'Subdirector'],
    ['secretary', 'Secretario'],
    ['secretary-treasurer', 'Secretario tesorero'],
    ['treasurer', 'Tesorero'],
  ])('labels %s as %s', (role, label) => {
    expect(directivaRoleLabel(role)).toBe(label);
  });

  it('falls back to the slug for unknown roles', () => {
    expect(directivaRoleLabel('counselor')).toBe('counselor');
  });
});
