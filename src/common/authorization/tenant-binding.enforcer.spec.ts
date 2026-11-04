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
});
