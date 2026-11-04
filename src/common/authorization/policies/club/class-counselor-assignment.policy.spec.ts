import { ErrorCode } from '../../../errors/error-codes';
import type { PolicyContext } from '../resource-policy';
import { InstanceScopeValidator } from '../scope/instance-scope';
import { ClassCounselorAssignmentPolicy } from './class-counselor-assignment.policy';

const section = { club_section_id: 5, main_club_id: 10, club_type_id: 2 };
const row = { club_sections: section };

describe('ClassCounselorAssignmentPolicy', () => {
  const build = (found: unknown, canManage: boolean) => {
    const prisma = {
      class_counselor_assignments: {
        findUnique: jest.fn().mockResolvedValue(found),
      },
    } as any;
    const authorizationContext = {
      canManageClub: jest.fn().mockResolvedValue(canManage),
    } as any;
    return new ClassCounselorAssignmentPolicy(
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
    resource: { type: 'class_counselor_assignment' },
  });

  it('handles the class_counselor_assignment resource type', () => {
    expect(build(row, true).type).toBe('class_counselor_assignment');
  });

  it('throws 404 when the resource does not exist', async () => {
    await expect(build(null, true).resolve(ctx())).rejects.toMatchObject({
      status: 404,
      code: ErrorCode.CLASS_COUNSELOR_ASSIGNMENT_NOT_FOUND,
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
