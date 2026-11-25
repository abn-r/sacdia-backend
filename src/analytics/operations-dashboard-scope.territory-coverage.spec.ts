import { OperationsDashboardScopeService } from './operations-dashboard-scope.service';
import { ErrorCode } from '../common/errors/error-codes';
import {
  actorProfile,
  TERRITORIAL_PERMISSIONS,
} from '../common/testing/actor-scope.fixture';

/**
 * B8 (union-division-app-surface): operations dashboard (function 5, S6.1).
 * The level is forced by the server from the actor's role; client-supplied
 * division/union/local-field ids can only drill DOWN inside the actor's own
 * territory, never sideways or up. Unconfigured territory answers 403
 * ADMIN_USER_SCOPE_MISSING (R1.5).
 *
 * Real code under test: OperationsDashboardScopeService.resolve. Doubles:
 * Prisma (territory tables), authorization profile, coordination.
 *
 * Enforcing code (operations-dashboard-scope.service.ts):
 * - base level from role: :81-130 (Division :90-95, Union :97-102,
 *   missing anchor -> ADMIN_USER_SCOPE_MISSING via :186-191)
 * - same-level filter check: :193-230
 * - target within base: :385-394 (denyOutsideScope -> GUARD_PERMISSION_DENIED :396)
 * Route role gate: analytics/analytics.controller.ts @GlobalRoles on
 * `operations-dashboard` (DIA and Union roles listed).
 */

const DIVISIONS: Record<number, { division_id: number; name: string }> = {
  1: { division_id: 1, name: 'Division 1' },
  2: { division_id: 2, name: 'Division 2' },
};
const UNIONS: Record<number, { union_id: number; division_id: number }> = {
  3: { union_id: 3, division_id: 1 },
  4: { union_id: 4, division_id: 1 },
  5: { union_id: 5, division_id: 2 },
};
const LOCAL_FIELDS: Record<
  number,
  { local_field_id: number; union_id: number }
> = {
  71: { local_field_id: 71, union_id: 3 },
  72: { local_field_id: 72, union_id: 4 },
  73: { local_field_id: 73, union_id: 5 },
};

const unionActor = () =>
  actorProfile({
    userId: 'union-1',
    globalRoles: [
      { roleName: 'director-union', permissions: TERRITORIAL_PERMISSIONS },
    ],
    territory: { union: { id: 3 }, division: { id: 1 } },
  });
const divisionActor = () =>
  actorProfile({
    userId: 'division-1',
    globalRoles: [
      { roleName: 'assistant-dia', permissions: TERRITORIAL_PERMISSIONS },
    ],
    territory: { division: { id: 1 } },
  });
const unconfiguredUnionActor = () =>
  actorProfile({
    userId: 'union-2',
    globalRoles: [
      { roleName: 'director-union', permissions: TERRITORIAL_PERMISSIONS },
    ],
    territory: {},
  });
const unconfiguredDivisionActor = () =>
  actorProfile({
    userId: 'division-2',
    globalRoles: [
      { roleName: 'director-dia', permissions: TERRITORIAL_PERMISSIONS },
    ],
    territory: {},
  });

describe('OperationsDashboardScopeService territory coverage (union-division-app-surface B8)', () => {
  let profile: ReturnType<typeof actorProfile>;
  let service: OperationsDashboardScopeService;

  beforeEach(() => {
    profile = unionActor();
    const prisma = {
      divisions: {
        findUnique: jest.fn(async ({ where }: any) => {
          return DIVISIONS[where.division_id] ?? null;
        }),
      },
      unions: {
        findUnique: jest.fn(async ({ where }: any) => {
          const row = UNIONS[where.union_id];
          return row
            ? {
                union_id: row.union_id,
                name: `Union ${row.union_id}`,
                divisions: DIVISIONS[row.division_id],
              }
            : null;
        }),
      },
      local_fields: {
        findUnique: jest.fn(async ({ where }: any) => {
          const row = LOCAL_FIELDS[where.local_field_id];
          if (!row) return null;
          const union = UNIONS[row.union_id];
          return {
            local_field_id: row.local_field_id,
            name: `LF ${row.local_field_id}`,
            unions: {
              union_id: union.union_id,
              name: `Union ${union.union_id}`,
              divisions: DIVISIONS[union.division_id],
            },
          };
        }),
      },
    };
    service = new OperationsDashboardScopeService(
      prisma as never,
      { resolveUserAuthorization: jest.fn(async () => profile) } as never,
      {} as never,
    );
  });

  describe('Union actor (union 3)', () => {
    it('with no filters, the level is forced to union 3', async () => {
      await expect(service.resolve('union-1', {})).resolves.toMatchObject({
        level: 'union',
        id: 3,
      });
    });

    it('may drill down to a local field of its own union', async () => {
      await expect(
        service.resolve('union-1', { localFieldId: 71 }),
      ).resolves.toMatchObject({ level: 'local_field', id: 71 });
    });

    it.each([
      ['another union of the same division', { unionId: 4 }],
      ['a union of another division', { unionId: 5 }],
      ['a division id of another division', { divisionId: 2 }],
      ['a local field of another union', { localFieldId: 72 }],
      ['a local field of another division', { localFieldId: 73 }],
    ])(
      'rejects %s with 403 GUARD_PERMISSION_DENIED (cannot widen)',
      async (_label, filters) => {
        await expect(service.resolve('union-1', filters)).rejects.toMatchObject(
          {
            status: 403,
            code: ErrorCode.GUARD_PERMISSION_DENIED,
          },
        );
      },
    );

    it('cannot widen to the whole system by sending no territory: the level stays union', async () => {
      const resolved = await service.resolve('union-1', {});

      expect(resolved.level).not.toBe('all');
      expect(resolved.path.map((node) => node.id)).toContain(3);
    });
  });

  describe('Division actor (division 1)', () => {
    beforeEach(() => {
      profile = divisionActor();
    });

    it('with no filters, the level is forced to division 1', async () => {
      await expect(service.resolve('division-1', {})).resolves.toMatchObject({
        level: 'division',
        id: 1,
      });
    });

    it.each([
      [{ unionId: 3 }, 'union', 3],
      [{ unionId: 4 }, 'union', 4],
      [{ localFieldId: 72 }, 'local_field', 72],
    ] as const)(
      'may drill down inside its division with %j',
      async (filters, level, id) => {
        await expect(
          service.resolve('division-1', filters),
        ).resolves.toMatchObject({ level, id });
      },
    );

    it.each([
      ['a union of division 2', { unionId: 5 }],
      ['a local field of division 2', { localFieldId: 73 }],
      ['division 2 itself', { divisionId: 2 }],
    ])(
      'rejects %s with 403 GUARD_PERMISSION_DENIED',
      async (_label, filters) => {
        await expect(
          service.resolve('division-1', filters),
        ).rejects.toMatchObject({
          status: 403,
          code: ErrorCode.GUARD_PERMISSION_DENIED,
        });
      },
    );

    it('an unknown territory id is also 403, so ids cannot be probed', async () => {
      await expect(
        service.resolve('division-1', { unionId: 999 }),
      ).rejects.toMatchObject({ code: ErrorCode.GUARD_PERMISSION_DENIED });
    });
  });

  describe('unconfigured territory (R1.5, S1.7)', () => {
    it('Union without a union id answers 403 ADMIN_USER_SCOPE_MISSING', async () => {
      profile = unconfiguredUnionActor();

      await expect(service.resolve('union-2', {})).rejects.toMatchObject({
        status: 403,
        code: ErrorCode.ADMIN_USER_SCOPE_MISSING,
      });
    });

    it('Division without a division id answers 403 ADMIN_USER_SCOPE_MISSING, even with a client filter', async () => {
      profile = unconfiguredDivisionActor();

      await expect(
        service.resolve('division-2', { unionId: 3 }),
      ).rejects.toMatchObject({ code: ErrorCode.ADMIN_USER_SCOPE_MISSING });
    });
  });
});
