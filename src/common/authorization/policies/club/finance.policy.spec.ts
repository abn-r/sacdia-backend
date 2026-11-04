import { ErrorCode } from '../../../errors/error-codes';
import type { PolicyContext } from '../resource-policy';
import { InstanceScopeValidator } from '../scope/instance-scope';
import { FinancePolicy } from './finance.policy';

const section = { club_section_id: 5, main_club_id: 10, club_type_id: 2 };
const row = { club_section_id: 5, club_sections: section };

describe('FinancePolicy', () => {
  const build = (found: unknown, canManage: boolean) => {
    const prisma = {
      finances: { findUnique: jest.fn().mockResolvedValue(found) },
    } as any;
    const authorizationContext = {
      canManageClub: jest.fn().mockResolvedValue(canManage),
    } as any;
    return new FinancePolicy(
      prisma,
      new InstanceScopeValidator(prisma, authorizationContext),
    );
  };
  const ctx = (): PolicyContext => ({
    userId: 'user-1',
    request: { params: { financeId: '3' } },
    resolved: {
      authorization: { effective: { scope: { club: null } } },
    } as any,
    requirement: { permissions: ['x:y'], mode: 'all' },
    resource: { type: 'finance' },
  });

  it('handles the finance resource type', () => {
    expect(build(row, true).type).toBe('finance');
  });

  it('throws 404 when the resource does not exist', async () => {
    await expect(build(null, true).resolve(ctx())).rejects.toMatchObject({
      status: 404,
      code: ErrorCode.FINANCE_TRANSACTION_NOT_FOUND,
    });
  });

  it('allows when the actor can manage the club', async () => {
    await expect(build(row, true).resolve(ctx())).resolves.toBe(true);
  });

  it('denies with GUARD_CLUB_SCOPE_REQUIRED otherwise', async () => {
    await expect(build(row, false).resolve(ctx())).rejects.toMatchObject({
      status: 403,
      code: ErrorCode.GUARD_CLUB_SCOPE_REQUIRED,
    });
  });
});
