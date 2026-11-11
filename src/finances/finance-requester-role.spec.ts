import { requesterRoleLabel } from './finance-requester-role';

const snapshot = (globalRoles: string[], club?: { id: number; role: string }) =>
  ({
    grants: { global_roles: globalRoles.map((role_name) => ({ role_name })) },
    effective: {
      scope: {
        club: club
          ? {
              role_name: club.role,
              club: { club_id: club.id, club_name: 'x' },
            }
          : null,
      },
    },
  }) as any;

describe('requesterRoleLabel', () => {
  it('uses the club role when the assignment belongs to the exported club', () => {
    expect(
      requesterRoleLabel(snapshot(['user'], { id: 1, role: 'treasurer' }), 1),
    ).toBe('Tesorero(a)');
    expect(
      requesterRoleLabel(snapshot([], { id: 1, role: 'director' }), 1),
    ).toBe('Director(a)');
  });

  it('prefers the strongest global role for another club', () => {
    expect(
      requesterRoleLabel(
        snapshot(['user', 'admin', 'pastor'], { id: 9, role: 'director' }),
        1,
      ),
    ).toBe('Administrador');
    expect(requesterRoleLabel(snapshot(['assistant-lf']), 1)).toBe(
      'Asistente de Campo local',
    );
  });

  it('falls back to the other club role and to null', () => {
    expect(
      requesterRoleLabel(snapshot(['user'], { id: 9, role: 'secretary' }), 1),
    ).toBe('Secretario(a)');
    expect(requesterRoleLabel(snapshot(['user']), 1)).toBeNull();
    expect(requesterRoleLabel(undefined, 1)).toBeNull();
  });
});
