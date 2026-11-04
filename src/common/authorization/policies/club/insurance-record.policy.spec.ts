import { ErrorCode } from '../../../errors/error-codes';
import type { PolicyContext } from '../resource-policy';
import { InstanceScopeValidator } from '../scope/instance-scope';
import { InsuranceRecordPolicy } from './insurance-record.policy';

const section = { club_section_id: 5, main_club_id: 10, club_type_id: 2 };
const row = { user_id: 'member-1' };

describe('InsuranceRecordPolicy', () => {
  const build = (found: unknown, canManage: boolean, assignments = 1) => {
    const prisma = {
      member_insurances: { findUnique: jest.fn().mockResolvedValue(found) },
      club_role_assignments: {
        findMany: jest.fn().mockResolvedValue(
          Array.from({ length: assignments }, () => ({
            club_sections: section,
          })),
        ),
      },
    } as any;
    const authorizationContext = {
      canManageClub: jest.fn().mockResolvedValue(canManage),
    } as any;
    const effectivity = {
      isAssignmentEffective: jest.fn().mockReturnValue(true),
    } as any;
    return new InsuranceRecordPolicy(
      prisma,
      new InstanceScopeValidator(prisma, authorizationContext),
      effectivity,
    );
  };
  const ctx = (): PolicyContext => ({
    userId: 'user-1',
    request: { params: { insuranceId: '2' } },
    resolved: {
      authorization: { effective: { scope: { club: null } } },
    } as any,
    requirement: { permissions: ['x:y'], mode: 'all' },
    resource: { type: 'insurance_record' },
  });

  it('handles the insurance_record resource type', () => {
    expect(build(row, true).type).toBe('insurance_record');
  });

  it('throws 404 when the resource does not exist', async () => {
    await expect(build(null, true).resolve(ctx())).rejects.toMatchObject({
      code: ErrorCode.INSURANCE_NOT_FOUND,
    });
  });

  it('allows when the actor can manage the club of a member assignment', async () => {
    await expect(build(row, true).resolve(ctx())).resolves.toBe(true);
  });

  it('denies with GUARD_CLUB_SCOPE_REQUIRED otherwise', async () => {
    await expect(build(row, false).resolve(ctx())).rejects.toMatchObject({
      code: ErrorCode.GUARD_CLUB_SCOPE_REQUIRED,
    });
  });

  it('denies when the member has no effective assignment', async () => {
    await expect(build(row, true, 0).resolve(ctx())).rejects.toMatchObject({
      code: ErrorCode.GUARD_CLUB_SCOPE_REQUIRED,
    });
  });
});
