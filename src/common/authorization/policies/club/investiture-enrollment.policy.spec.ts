import { ErrorCode } from '../../../errors/error-codes';
import type { PolicyContext } from '../resource-policy';
import { InstanceScopeValidator } from '../scope/instance-scope';
import { InvestitureEnrollmentPolicy } from './investiture-enrollment.policy';

const section = { club_section_id: 5, main_club_id: 10, club_type_id: 2 };
const enrollment = {
  user_id: 'member-1',
  ecclesiastical_year_id: 1,
  classes: { club_type_id: 2 },
};

describe('InvestitureEnrollmentPolicy', () => {
  const build = (found: unknown, canManage: boolean, effective = true) => {
    const prisma = {
      enrollments: { findFirst: jest.fn().mockResolvedValue(found) },
      club_role_assignments: {
        findMany: jest.fn().mockResolvedValue([{ club_sections: section }]),
      },
    } as any;
    const authorizationContext = {
      canManageClub: jest.fn().mockResolvedValue(canManage),
    } as any;
    const effectivity = {
      isAssignmentEffective: jest.fn().mockReturnValue(effective),
    } as any;
    return new InvestitureEnrollmentPolicy(
      prisma,
      new InstanceScopeValidator(prisma, authorizationContext),
      effectivity,
    );
  };
  const ctx = (): PolicyContext => ({
    userId: 'user-1',
    request: { params: { enrollmentId: '9' } },
    resolved: {
      authorization: { effective: { scope: { club: null } } },
    } as any,
    requirement: { permissions: ['x:y'], mode: 'all' },
    resource: { type: 'investiture_enrollment' },
  });

  it('handles the investiture_enrollment resource type', () => {
    expect(build(enrollment, true).type).toBe('investiture_enrollment');
  });

  it('throws 404 when the enrollment does not exist', async () => {
    await expect(build(null, true).resolve(ctx())).rejects.toMatchObject({
      code: ErrorCode.INVESTITURE_ENROLLMENT_NOT_FOUND,
    });
  });

  it('allows when the actor can manage the club of the member assignment', async () => {
    await expect(build(enrollment, true).resolve(ctx())).resolves.toBe(true);
  });

  it('denies with GUARD_CLUB_SCOPE_REQUIRED otherwise', async () => {
    await expect(build(enrollment, false).resolve(ctx())).rejects.toMatchObject(
      { code: ErrorCode.GUARD_CLUB_SCOPE_REQUIRED },
    );
  });

  it('denies when no assignment is effective', async () => {
    await expect(
      build(enrollment, true, false).resolve(ctx()),
    ).rejects.toMatchObject({ code: ErrorCode.GUARD_CLUB_SCOPE_REQUIRED });
  });
});
