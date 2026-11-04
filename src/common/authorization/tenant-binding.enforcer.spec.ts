import { ErrorCode } from '../errors/error-codes';
import type { PolicyContext } from './policies/resource-policy';
import { TenantBindingEnforcer } from './tenant-binding.enforcer';

describe('TenantBindingEnforcer', () => {
  const build = (opts: { canManage?: boolean; section?: unknown } = {}) => {
    const prisma = {
      club_sections: {
        findUnique: jest
          .fn()
          .mockResolvedValue(
            opts.section ?? { club_section_id: 5, main_club_id: 10 },
          ),
      },
    } as any;
    const authorizationContext = {
      canManageClub: jest.fn().mockResolvedValue(opts.canManage ?? false),
    } as any;
    return new TenantBindingEnforcer(
      prisma,
      authorizationContext,
      {} as any,
      {} as any,
    );
  };
  const ctx = (bind: any[], body: any = {}): PolicyContext => ({
    userId: 'user-1',
    request: { params: {}, body },
    resolved: {
      authorization: { effective: { scope: { club: null } } },
    } as any,
    requirement: { permissions: ['x:y'], mode: 'all' },
    resource: { type: 'global', bind } as any,
  });

  it('rejects a missing required binding with GUARD_CLUB_SCOPE_REQUIRED', async () => {
    await expect(
      build().enforce(
        ctx([{ source: 'body', field: 'club_id', kind: 'club' }]),
      ),
    ).rejects.toMatchObject({
      status: 403,
      code: ErrorCode.GUARD_CLUB_SCOPE_REQUIRED,
    });
  });

  it('skips a missing optional binding', async () => {
    await expect(
      build().enforce(
        ctx([
          { source: 'body', field: 'club_id', kind: 'club', optional: true },
        ]),
      ),
    ).resolves.toBeUndefined();
  });

  it('allows a club binding the actor can manage', async () => {
    await expect(
      build({ canManage: true }).enforce(
        ctx([{ source: 'body', field: 'club_id', kind: 'club' }], {
          club_id: 10,
        }),
      ),
    ).resolves.toBeUndefined();
  });

  it('denies a club_section binding the actor cannot manage', async () => {
    await expect(
      build({ canManage: false }).enforce(
        ctx([{ source: 'body', field: 'section_id', kind: 'club_section' }], {
          section_id: 5,
        }),
      ),
    ).rejects.toMatchObject({
      status: 403,
      code: ErrorCode.GUARD_CLUB_SCOPE_REQUIRED,
    });
  });

  describe('participant and membership kinds', () => {
    const forbidden = {
      status: 403,
      code: ErrorCode.GUARD_CLUB_SCOPE_REQUIRED,
    };
    const grant = (over: any = {}) => ({
      operational: true,
      club: { club_id: 10 },
      section: { club_section_id: 5 },
      scope: { union: { id: 1 }, local_field: { id: 50 } },
      ...over,
    });
    const run = (
      bind: any,
      opts: {
        canManage?: boolean;
        hierarchyOk?: boolean;
        participantOk?: boolean;
        grants?: any[];
        section?: unknown;
      },
      value = 7,
    ) => {
      const { AppForbiddenException } = jest.requireActual(
        '../errors/app.exception',
      );
      const prisma = {
        club_sections: {
          findUnique: jest
            .fn()
            .mockResolvedValue(
              opts.section === undefined
                ? { club_section_id: 5, main_club_id: 10 }
                : opts.section,
            ),
        },
      } as any;
      const authorizationContext = {
        canManageClub: jest.fn().mockResolvedValue(opts.canManage ?? false),
      } as any;
      const territory = {
        loadHierarchyScope: jest.fn().mockResolvedValue({}),
        assertHierarchyAccess: jest.fn(() => {
          if (!opts.hierarchyOk) {
            throw new AppForbiddenException(
              ErrorCode.GUARD_CLUB_SCOPE_REQUIRED,
            );
          }
        }),
        validateUnionCamporeeScope: jest.fn(async () => {
          if (!opts.participantOk) {
            throw new AppForbiddenException(
              ErrorCode.GUARD_CLUB_SCOPE_REQUIRED,
            );
          }
        }),
      } as any;
      const loader = {
        loadUnionCamporeeScope: jest.fn().mockResolvedValue({}),
      } as any;
      const enforcer = new TenantBindingEnforcer(
        prisma,
        authorizationContext,
        territory,
        loader,
      );
      const context = ctx([{ source: 'param', field: 'id', ...bind }]);
      context.request = { params: { id: String(value) }, body: {} };
      context.resolved = {
        authorization: {
          grants: { club_assignments: opts.grants ?? [] },
          effective: { scope: { club: null } },
        },
      } as any;
      return enforcer.enforce(context);
    };

    it('union_camporee_participant delegates to validateUnionCamporeeScope', async () => {
      const bind = { kind: 'union_camporee_participant' };
      await expect(run(bind, { participantOk: true })).resolves.toBeUndefined();
      await expect(run(bind, { participantOk: false })).rejects.toMatchObject(
        forbidden,
      );
    });

    it('club_section_membership: allow via canManageClub, allow via membership, deny', async () => {
      const bind = { kind: 'club_section_membership' };
      await expect(run(bind, { canManage: true })).resolves.toBeUndefined();
      await expect(run(bind, { grants: [grant()] })).resolves.toBeUndefined();
      await expect(
        run(bind, {
          grants: [
            grant({ club: { club_id: 99 }, section: { club_section_id: 6 } }),
          ],
        }),
      ).rejects.toMatchObject(forbidden);
      await expect(
        run(bind, { grants: [grant({ operational: false })] }),
      ).rejects.toMatchObject(forbidden);
    });

    it('club_section_membership returns 404 for an unknown section', async () => {
      await expect(
        run({ kind: 'club_section_membership' }, { section: null }),
      ).rejects.toMatchObject({
        status: 404,
        code: ErrorCode.CLUB_SECTION_NOT_FOUND,
      });
    });

    it.each([
      ['union_membership', 1, { union: { id: 2 } }],
      ['local_field_membership', 50, { local_field: { id: 60 } }],
    ])(
      '%s: allow via hierarchy, allow via membership, deny',
      async (kind, id, otherScope) => {
        const bind = { kind };
        await expect(
          run(bind, { hierarchyOk: true }, id),
        ).resolves.toBeUndefined();
        await expect(
          run(bind, { grants: [grant()] }, id),
        ).resolves.toBeUndefined();
        await expect(
          run(bind, { grants: [grant({ scope: otherScope })] }, id),
        ).rejects.toMatchObject(forbidden);
        await expect(run(bind, {}, id)).rejects.toMatchObject(forbidden);
      },
    );
  });
});
