import { ErrorCode } from '../common/errors/error-codes';
import { OperationsDashboardScopeService } from './operations-dashboard-scope.service';

const division = (id: number) => ({
  division_id: id,
  name: `División ${id}`,
});

const union = (id: number, divisionId: number) => ({
  union_id: id,
  name: `Unión ${id}`,
  divisions: division(divisionId),
});

const localField = (id: number, unionId: number, divisionId: number) => ({
  local_field_id: id,
  name: `Campo ${id}`,
  unions: union(unionId, divisionId),
});

const resolvedAuth = ({
  roles,
  divisionId,
  unionId,
  localFieldId,
}: {
  roles: string[];
  divisionId?: number;
  unionId?: number;
  localFieldId?: number;
}) => ({
  authorization: {
    grants: {
      global_roles: roles.map((role_name) => ({
        role_name,
        permissions: [],
        scope: {},
      })),
      club_assignments: [],
    },
    active_assignment: { assignment_id: null },
    effective: {
      permissions: [],
      scope: {
        global: {
          ...(divisionId === undefined
            ? {}
            : { division: { id: divisionId, name: `División ${divisionId}` } }),
          ...(unionId === undefined
            ? {}
            : { union: { id: unionId, name: `Unión ${unionId}` } }),
          ...(localFieldId === undefined
            ? {}
            : {
                local_field: {
                  id: localFieldId,
                  name: `Campo ${localFieldId}`,
                },
              }),
        },
        club: null,
      },
    },
  },
});

describe('OperationsDashboardScopeService', () => {
  const authorizationContext = {
    resolveUserAuthorization: jest.fn(),
  };
  const prisma = {
    divisions: { findUnique: jest.fn() },
    unions: { findUnique: jest.fn() },
    local_fields: { findUnique: jest.fn() },
  };

  let service: OperationsDashboardScopeService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new OperationsDashboardScopeService(
      prisma as any,
      authorizationContext as any,
    );

    prisma.divisions.findUnique.mockImplementation(({ where }) =>
      Promise.resolve(where.division_id === 1 ? division(1) : null),
    );
    prisma.unions.findUnique.mockImplementation(({ where }) => {
      if (where.union_id === 10) return Promise.resolve(union(10, 1));
      if (where.union_id === 20) return Promise.resolve(union(20, 2));
      return Promise.resolve(null);
    });
    prisma.local_fields.findUnique.mockImplementation(({ where }) => {
      if (where.local_field_id === 100)
        return Promise.resolve(localField(100, 10, 1));
      if (where.local_field_id === 200)
        return Promise.resolve(localField(200, 20, 2));
      return Promise.resolve(null);
    });
  });

  it('grants global scope only to super-admin', async () => {
    authorizationContext.resolveUserAuthorization.mockResolvedValue(
      resolvedAuth({ roles: ['super-admin'] }),
    );

    await expect(service.resolve('actor', {})).resolves.toEqual({
      level: 'all',
      id: null,
      name: 'Todos',
      path: [],
    });
    expect(prisma.divisions.findUnique).not.toHaveBeenCalled();
  });

  it.each(['admin', 'assistant-admin'])(
    'forces %s to its effective union before broader or narrower location fields',
    async (role) => {
      authorizationContext.resolveUserAuthorization.mockResolvedValue(
        resolvedAuth({
          roles: [role],
          divisionId: 1,
          unionId: 10,
          localFieldId: 100,
        }),
      );

      await expect(service.resolve('actor', {})).resolves.toMatchObject({
        level: 'union',
        id: 10,
      });
      await expect(
        service.resolve('actor', { localFieldId: 100 }),
      ).resolves.toMatchObject({ level: 'local_field', id: 100 });
      await expect(
        service.resolve('actor', { localFieldId: 200 }),
      ).rejects.toMatchObject({
        code: ErrorCode.GUARD_PERMISSION_DENIED,
        status: 403,
      });
    },
  );

  it('uses local field before division for an administrative role without union scope', async () => {
    authorizationContext.resolveUserAuthorization.mockResolvedValue(
      resolvedAuth({
        roles: ['assistant-admin'],
        divisionId: 1,
        localFieldId: 100,
      }),
    );

    await expect(service.resolve('actor', {})).resolves.toMatchObject({
      level: 'local_field',
      id: 100,
    });
  });

  it('falls back to division scope for an administrative role', async () => {
    authorizationContext.resolveUserAuthorization.mockResolvedValue(
      resolvedAuth({ roles: ['admin'], divisionId: 1 }),
    );

    await expect(service.resolve('actor', {})).resolves.toMatchObject({
      level: 'division',
      id: 1,
    });
  });

  it('forces division leadership to its effective division and allows a descendant union', async () => {
    authorizationContext.resolveUserAuthorization.mockResolvedValue(
      resolvedAuth({ roles: ['director-dia'], divisionId: 1 }),
    );

    await expect(service.resolve('actor', {})).resolves.toEqual({
      level: 'division',
      id: 1,
      name: 'División 1',
      path: [{ level: 'division', id: 1, name: 'División 1' }],
    });

    await expect(
      service.resolve('actor', { unionId: 10 }),
    ).resolves.toMatchObject({ level: 'union', id: 10, name: 'Unión 10' });
  });

  it.each(['director-dia', 'assistant-dia'])(
    'denies a sibling union to %s',
    async (role) => {
      authorizationContext.resolveUserAuthorization.mockResolvedValue(
        resolvedAuth({ roles: [role], divisionId: 1 }),
      );

      await expect(
        service.resolve('actor', { unionId: 20 }),
      ).rejects.toMatchObject({ code: ErrorCode.GUARD_PERMISSION_DENIED });
    },
  );

  it('returns the same 403 for an existing out-of-scope union and an unknown union', async () => {
    authorizationContext.resolveUserAuthorization.mockResolvedValue(
      resolvedAuth({ roles: ['director-dia'], divisionId: 1 }),
    );

    for (const unionId of [20, 999]) {
      await expect(service.resolve('actor', { unionId })).rejects.toMatchObject(
        {
          code: ErrorCode.GUARD_PERMISSION_DENIED,
          status: 403,
        },
      );
    }
  });

  it('checks actor containment before reporting an inconsistent requested chain', async () => {
    authorizationContext.resolveUserAuthorization.mockResolvedValue(
      resolvedAuth({ roles: ['director-dia'], divisionId: 1 }),
    );

    await expect(
      service.resolve('actor', { divisionId: 1, unionId: 20 }),
    ).rejects.toMatchObject({
      code: ErrorCode.GUARD_PERMISSION_DENIED,
      status: 403,
    });
  });

  it.each(['director-union', 'assistant-union'])(
    'forces %s to its union and permits a child local field',
    async (role) => {
      authorizationContext.resolveUserAuthorization.mockResolvedValue(
        resolvedAuth({ roles: [role], divisionId: 1, unionId: 10 }),
      );

      await expect(
        service.resolve('actor', { localFieldId: 100 }),
      ).resolves.toMatchObject({
        level: 'local_field',
        id: 100,
        name: 'Campo 100',
      });
    },
  );

  it.each(['director-lf', 'assistant-lf'])(
    'forces %s to its local field and denies a sibling filter',
    async (role) => {
      authorizationContext.resolveUserAuthorization.mockResolvedValue(
        resolvedAuth({
          roles: [role],
          divisionId: 1,
          unionId: 10,
          localFieldId: 100,
        }),
      );

      await expect(service.resolve('actor', {})).resolves.toMatchObject({
        level: 'local_field',
        id: 100,
      });
      await expect(
        service.resolve('actor', { localFieldId: 200 }),
      ).rejects.toMatchObject({ code: ErrorCode.GUARD_PERMISSION_DENIED });
    },
  );

  it('rejects coordinators and club-only actors', async () => {
    authorizationContext.resolveUserAuthorization.mockResolvedValueOnce(
      resolvedAuth({ roles: ['coordinator'], localFieldId: 100 }),
    );
    await expect(service.resolve('coordinator', {})).rejects.toMatchObject({
      code: ErrorCode.GUARD_PERMISSION_DENIED,
    });

    authorizationContext.resolveUserAuthorization.mockResolvedValueOnce(
      resolvedAuth({ roles: [] }),
    );
    await expect(service.resolve('club-actor', {})).rejects.toMatchObject({
      code: ErrorCode.GUARD_PERMISSION_DENIED,
    });
  });

  it('returns 400 for an internally inconsistent requested chain', async () => {
    authorizationContext.resolveUserAuthorization.mockResolvedValue(
      resolvedAuth({ roles: ['super-admin'] }),
    );

    await expect(
      service.resolve('actor', { divisionId: 1, localFieldId: 200 }),
    ).rejects.toMatchObject({
      code: ErrorCode.ANALYTICS_SCOPE_CHAIN_INVALID,
      status: 400,
    });
  });

  it('uses canonical 404 errors for missing geography', async () => {
    authorizationContext.resolveUserAuthorization.mockResolvedValue(
      resolvedAuth({ roles: ['super-admin'] }),
    );

    await expect(
      service.resolve('actor', { unionId: 999 }),
    ).rejects.toMatchObject({
      code: ErrorCode.ADMIN_UNION_NOT_FOUND,
      status: 404,
    });
  });

  it('rejects a scoped role whose effective territory is missing', async () => {
    authorizationContext.resolveUserAuthorization.mockResolvedValue(
      resolvedAuth({ roles: ['assistant-dia'] }),
    );

    await expect(service.resolve('actor', {})).rejects.toMatchObject({
      code: ErrorCode.ADMIN_USER_SCOPE_MISSING,
    });
  });

  it.each(['admin', 'assistant-admin'])(
    'rejects misconfigured %s without effective territory',
    async (role) => {
      authorizationContext.resolveUserAuthorization.mockResolvedValue(
        resolvedAuth({ roles: [role] }),
      );

      await expect(service.resolve('actor', {})).rejects.toMatchObject({
        code: ErrorCode.ADMIN_USER_SCOPE_MISSING,
        status: 403,
      });
    },
  );
});
