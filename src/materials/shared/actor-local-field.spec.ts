import type { AuthorizationSnapshot } from '../../common/services/authorization-context.service';
import { resolveActorLocalField } from './actor-local-field';

function snapshot(options: {
  role: string;
  localFieldId?: number;
  unionId?: number;
  clubId?: number;
}): AuthorizationSnapshot {
  return {
    grants: {
      global_roles: [
        { role_name: options.role, permissions: [], scope: {} },
      ],
      club_assignments: [],
      direct_permissions: [],
    },
    active_assignment: { assignment_id: null },
    effective: {
      permissions: [],
      scope: {
        global: {
          ...(options.unionId === undefined
            ? {}
            : { union: { id: options.unionId } }),
          ...(options.localFieldId === undefined
            ? {}
            : { local_field: { id: options.localFieldId } }),
        },
        club: options.clubId
          ? {
              assignment_id: 'a1',
              role_name: 'director',
              club: { club_id: options.clubId, club_name: 'Orión' },
              section: { club_section_id: 1, club_type_id: 2 },
            }
          : null,
      },
    },
  };
}

describe('resolveActorLocalField', () => {
  const prisma = {
    clubs: { findUnique: jest.fn() },
  } as never;

  it('does not collapse director-union to the home local_field', async () => {
    await expect(
      resolveActorLocalField(
        prisma,
        snapshot({
          role: 'director-union',
          localFieldId: 9,
          unionId: 2,
        }),
      ),
    ).resolves.toEqual({ scope: 'union', unionId: 2 });
  });

  it('binds director-lf to a single local field', async () => {
    await expect(
      resolveActorLocalField(
        prisma,
        snapshot({ role: 'director-lf', localFieldId: 9, unionId: 2 }),
      ),
    ).resolves.toEqual({ scope: 'single', localFieldId: 9 });
  });
});
