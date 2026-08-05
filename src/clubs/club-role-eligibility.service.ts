import { Injectable } from '@nestjs/common';
import { Prisma, investiture_status_enum } from '@prisma/client';
import { AppForbiddenException } from '../common/errors/app.exception';
import { ErrorCode } from '../common/errors/error-codes';
import { PrismaService } from '../prisma/prisma.service';

const GUIDE_MAJOR_ASSET_CODE = 'GM-01';
const ACTIVE_GUIDE_MAJOR_STATUSES = [
  investiture_status_enum.IN_PROGRESS,
  investiture_status_enum.SUBMITTED_FOR_VALIDATION,
  investiture_status_enum.CLUB_APPROVED,
  investiture_status_enum.COORDINATOR_APPROVED,
  investiture_status_enum.FIELD_APPROVED,
] as const;

type EligibilityClient =
  | Pick<PrismaService, 'enrollments'>
  | Prisma.TransactionClient;

export type ClubRoleEligibility = {
  eligible: boolean;
  basis: 'MEMBER_EXEMPT' | 'HISTORICAL_INVESTED' | 'ACTIVE_ENROLLMENT' | null;
  enrollmentId?: number;
};

/**
 * The P0 source of truth for the GM-01 gate on CLUB role assignments.
 * Consumers must call it inside their mutation transaction; member is the only
 * exempt canonical CLUB role and no localized class name participates here.
 */
@Injectable()
export class ClubRoleEligibilityService {
  constructor(private readonly prisma: PrismaService) {}

  async evaluate(
    userId: string,
    roleName: string,
    db: EligibilityClient = this.prisma,
  ): Promise<ClubRoleEligibility> {
    if (roleName === 'member') {
      return { eligible: true, basis: 'MEMBER_EXEMPT' };
    }

    const enrollment = await db.enrollments.findFirst({
      where: {
        user_id: userId,
        OR: [
          {
            investiture_status: investiture_status_enum.INVESTIDO,
            classes: { asset_code: GUIDE_MAJOR_ASSET_CODE },
          },
          {
            active: true,
            investiture_status: { in: [...ACTIVE_GUIDE_MAJOR_STATUSES] },
            classes: { asset_code: GUIDE_MAJOR_ASSET_CODE, active: true },
          },
        ],
      },
      select: { enrollment_id: true, investiture_status: true },
      orderBy: { enrollment_date: 'desc' },
    });

    if (!enrollment) {
      return { eligible: false, basis: null };
    }

    return {
      eligible: true,
      enrollmentId: enrollment.enrollment_id,
      basis:
        enrollment.investiture_status === investiture_status_enum.INVESTIDO
          ? 'HISTORICAL_INVESTED'
          : 'ACTIVE_ENROLLMENT',
    };
  }

  async assertEligible(
    userId: string,
    roleName: string,
    db: EligibilityClient = this.prisma,
  ): Promise<ClubRoleEligibility> {
    const eligibility = await this.evaluate(userId, roleName, db);
    if (!eligibility.eligible) {
      throw new AppForbiddenException(ErrorCode.CLUB_ROLE_GUIDE_MAJOR_REQUIRED);
    }

    return eligibility;
  }
}
