import type { ExecutionContext } from '@nestjs/common';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { AppForbiddenException } from '../common/errors/app.exception';
import { ErrorCode } from '../common/errors/error-codes';
import { PrismaService } from '../prisma/prisma.service';
import {
  ExactSuperAdminWriteGuard,
  ExactSuperAdminWritePolicy,
} from './exact-super-admin-write.policy';

const ACTOR_ID = '11111111-1111-1111-1111-111111111111';

describe('ExactSuperAdminWritePolicy', () => {
  const users_roles = { findFirst: jest.fn() };
  const policy = new ExactSuperAdminWritePolicy({ users_roles } as Pick<
    PrismaService,
    'users_roles'
  >);

  beforeEach(() => jest.clearAllMocks());

  it('requires an active GLOBAL super-admin assignment with the exact role name', async () => {
    users_roles.findFirst.mockResolvedValue(null);

    await expect(policy.assert(ACTOR_ID)).rejects.toMatchObject({
      code: ErrorCode.SUPER_ADMIN_WRITE_REQUIRED,
    });
    expect(users_roles.findFirst).toHaveBeenCalledWith({
      where: {
        user_id: ACTOR_ID,
        active: true,
        roles: {
          role_name: 'super-admin',
          role_category: 'GLOBAL',
          active: true,
        },
      },
      select: { user_role_id: true },
    });
  });

  it('allows only the exact current assignment', async () => {
    users_roles.findFirst.mockResolvedValue({ user_role_id: 'assignment-id' });
    await expect(policy.assert(ACTOR_ID)).resolves.toBeUndefined();
  });
});

describe('ExactSuperAdminWriteGuard', () => {
  it('uses the authenticated request subject and delegates to the policy', async () => {
    const assert = jest.fn().mockResolvedValue(undefined);
    const guard = new ExactSuperAdminWriteGuard({ assert });
    const context = {
      switchToHttp: () => ({ getRequest: () => ({ user: { sub: ACTOR_ID } }) }),
    } as unknown as ExecutionContext;

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(assert).toHaveBeenCalledWith(ACTOR_ID);
  });

  it('fails closed when a controller request lacks an authenticated subject', async () => {
    const guard = new ExactSuperAdminWriteGuard({ assert: jest.fn() });
    const context = {
      switchToHttp: () => ({ getRequest: () => ({ user: undefined }) }),
    } as unknown as ExecutionContext;

    await expect(guard.canActivate(context)).rejects.toEqual(
      new AppForbiddenException(ErrorCode.SUPER_ADMIN_WRITE_REQUIRED),
    );
  });
});

describe('P0 RBAC write errors', () => {
  it.each(['es', 'en', 'fr', 'pt-BR'])(
    'declares both stable codes in %s',
    (locale) => {
      const messages = JSON.parse(
        readFileSync(
          join(process.cwd(), 'src', 'i18n', locale, 'errors.json'),
          'utf8',
        ),
      ) as Record<string, string>;

      expect(messages[ErrorCode.SUPER_ADMIN_WRITE_REQUIRED]).toBeTruthy();
      expect(messages[ErrorCode.RBAC_GLOBAL_ROLE_REQUIRED]).toBeTruthy();
    },
  );
});
