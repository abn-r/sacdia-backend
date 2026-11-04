import { ErrorCode } from '../../../errors/error-codes';
import type { PolicyContext } from '../resource-policy';
import { InstanceScopeValidator } from '../scope/instance-scope';
import { ClubAssignmentPolicy } from './club-assignment.policy';

const section = { club_section_id: 5, main_club_id: 10, club_type_id: 2 };
const row = { club_section_id: 5, club_sections: section };

describe('ClubAssignmentPolicy', () => {
  const build = (found: unknown, canManage: boolean) => {
    const prisma = {
      club_role_assignments: { findUnique: jest.fn().mockResolvedValue(found) },
    } as any;
    const authorizationContext = {
      canManageClub: jest.fn().mockResolvedValue(canManage),
    } as any;
    return new ClubAssignmentPolicy(
      prisma,
      new InstanceScopeValidator(prisma, authorizationContext),
    );
  };
  const ctx = (): PolicyContext => ({
    userId: 'user-1',
    request: {
      params: { assignmentId: '11111111-1111-4111-8111-111111111111' },
    },
    resolved: {
      authorization: { effective: { scope: { club: null } } },
    } as any,
    requirement: { permissions: ['x:y'], mode: 'all' },
    resource: { type: 'club_assignment' },
  });

  it('handles the club_assignment resource type', () => {
    expect(build(row, true).type).toBe('club_assignment');
  });

  it('throws 404 when the resource does not exist', async () => {
    await expect(build(null, true).resolve(ctx())).rejects.toMatchObject({
      status: 404,
      code: ErrorCode.GUARD_ASSIGNMENT_NOT_FOUND,
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
