import { investiture_status_enum } from '@prisma/client';
import { AppForbiddenException } from '../common/errors/app.exception';
import { ErrorCode } from '../common/errors/error-codes';
import { ClubRoleEligibilityService } from './club-role-eligibility.service';

const userId = '00000000-0000-0000-0000-000000000001';
const findFirst = jest.fn();
const service = new ClubRoleEligibilityService({
  enrollments: { findFirst },
} as never);

const enrollment = (status: investiture_status_enum, enrollmentId = 11) => ({
  enrollment_id: enrollmentId,
  investiture_status: status,
});

const activeGuideMajorStatuses = [
  investiture_status_enum.IN_PROGRESS,
  investiture_status_enum.SUBMITTED_FOR_VALIDATION,
  investiture_status_enum.CLUB_APPROVED,
  investiture_status_enum.COORDINATOR_APPROVED,
  investiture_status_enum.FIELD_APPROVED,
];

const expectedGuideMajorQuery = {
  where: {
    user_id: userId,
    OR: [
      {
        investiture_status: investiture_status_enum.INVESTIDO,
        classes: { asset_code: 'GM-01' },
      },
      {
        active: true,
        investiture_status: { in: activeGuideMajorStatuses },
        classes: { asset_code: 'GM-01', active: true },
      },
    ],
  },
  select: { enrollment_id: true, investiture_status: true },
  orderBy: { enrollment_date: 'desc' },
};

describe('ClubRoleEligibilityService', () => {
  beforeEach(() => jest.clearAllMocks());

  it('ELIG-A: exempts the exact canonical member role without querying', async () => {
    await expect(service.assertEligible(userId, 'member')).resolves.toEqual({
      eligible: true,
      basis: 'MEMBER_EXEMPT',
    });
    expect(findFirst).not.toHaveBeenCalled();
  });

  it.each(activeGuideMajorStatuses)(
    'ELIG-B: accepts active GM-01 enrollment in %s',
    async (status) => {
      findFirst.mockResolvedValue(enrollment(status));

      await expect(service.assertEligible(userId, 'director')).resolves.toEqual(
        {
          eligible: true,
          basis: 'ACTIVE_ENROLLMENT',
          enrollmentId: 11,
        },
      );
      expect(findFirst).toHaveBeenCalledWith(expectedGuideMajorQuery);
    },
  );

  it('ELIG-C: accepts historical INVESTIDO even after the class is inactive', async () => {
    findFirst.mockResolvedValue(
      enrollment(investiture_status_enum.INVESTIDO, 12),
    );

    await expect(service.assertEligible(userId, 'director')).resolves.toEqual({
      eligible: true,
      basis: 'HISTORICAL_INVESTED',
      enrollmentId: 12,
    });
    expect(findFirst).toHaveBeenCalledWith(expectedGuideMajorQuery);
  });

  it.each([
    investiture_status_enum.APPROVED,
    investiture_status_enum.REJECTED,
    investiture_status_enum.EXPIRED,
  ])('ELIG-D: rejects %s when it is the only GM-01 record', async () => {
    findFirst.mockResolvedValue(null);

    await expect(
      service.assertEligible(userId, 'director'),
    ).rejects.toMatchObject({
      code: ErrorCode.CLUB_ROLE_GUIDE_MAJOR_REQUIRED,
    } satisfies Partial<AppForbiddenException>);
  });

  it('ELIG-E: re-evaluates activation-time eligibility instead of retaining a prior grant', async () => {
    findFirst.mockResolvedValueOnce(
      enrollment(investiture_status_enum.IN_PROGRESS),
    );
    await expect(
      service.assertEligible(userId, 'director'),
    ).resolves.toMatchObject({
      eligible: true,
    });

    findFirst.mockResolvedValueOnce(null);
    await expect(
      service.assertEligible(userId, 'director'),
    ).rejects.toMatchObject({
      code: ErrorCode.CLUB_ROLE_GUIDE_MAJOR_REQUIRED,
    } satisfies Partial<AppForbiddenException>);
  });

  it('ELIG-F: identifies GM canonically, not through localized names', async () => {
    findFirst.mockResolvedValue(null);

    await expect(service.evaluate(userId, 'director')).resolves.toEqual({
      eligible: false,
      basis: null,
    });
    expect(findFirst).toHaveBeenCalledWith(expectedGuideMajorQuery);
  });

  it.each(['member ', 'member-director', 'Member', 'miembro'])(
    'does not exempt the non-canonical member near-miss %p',
    async (roleName) => {
      findFirst.mockResolvedValue(null);

      await expect(
        service.assertEligible(userId, roleName),
      ).rejects.toMatchObject({
        code: ErrorCode.CLUB_ROLE_GUIDE_MAJOR_REQUIRED,
      } satisfies Partial<AppForbiddenException>);
      expect(findFirst).toHaveBeenCalledWith(expectedGuideMajorQuery);
    },
  );
});
