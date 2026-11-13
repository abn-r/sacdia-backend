import { HttpStatus, Injectable } from '@nestjs/common';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import {
  AppException,
  AppNotFoundException,
} from '../common/errors/app.exception';
import { ErrorCode } from '../common/errors/error-codes';
import { PrismaService } from '../prisma/prisma.service';
import { hasLiveAssignmentInSection, type Db } from './guardianship-queries';
import { MAJORITY_RELEASE_FROZEN_REASON } from './guardianships.constants';
import { LinkCodesService, type IssuedLinkCode } from './link-codes.service';

export type AdultClaimTargetState =
  'claimable' | 'has_account' | 'not_released' | 'gone';

/**
 * Is this person a released, account-less adult who can claim an account?
 *
 * Ruling R6: a person frozen BY THE RELEASE (`frozen_reason = 'majority_release'`)
 * is still claimable, with no deadline. A legacy freeze (a minor frozen for
 * lack of a guardian) and a completed release are not.
 */
export async function adultClaimTargetState(
  db: Db,
  dependentId: string,
): Promise<AdultClaimTargetState> {
  const user = await db.users.findUnique({
    where: { user_id: dependentId },
    select: {
      active: true,
      account: { select: { id: true }, take: 1 },
      supervised_login: { select: { user_id: true } },
      dependent_profile: {
        select: {
          released_at: true,
          release_completed_at: true,
          frozen_at: true,
          frozen_reason: true,
          purged_at: true,
        },
      },
    },
  });
  const profile = user?.dependent_profile;
  if (!user || !user.active || !profile || profile.purged_at) return 'gone';
  if (user.account.length > 0 || user.supervised_login) return 'has_account';
  const legacyFreeze =
    profile.frozen_at !== null &&
    profile.frozen_reason !== MAJORITY_RELEASE_FROZEN_REASON;
  if (!profile.released_at || profile.release_completed_at || legacyFreeze) {
    return 'not_released';
  }
  return 'claimable';
}

function notReleased(): AppException {
  return new AppException(
    ErrorCode.FAMILY_ADULT_CLAIM_NOT_RELEASED,
    HttpStatus.CONFLICT,
  );
}

/**
 * Issues the access code a released, account-less adult redeems to claim their
 * own account. Two issuers, at ANY time after the release (also while frozen,
 * ruling R6): a FORMER GUARDIAN (the row revoked with reason `released`) and a
 * CLUB DIRECTOR of the section the person belongs to. The plain code leaves the
 * server once, in the response; only its HMAC is stored. The audit never holds
 * the code.
 */
@Injectable()
export class AdultClaimIssueService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly linkCodes: LinkCodesService,
    private readonly audit: AuditLogsService,
  ) {}

  async issueForFormerGuardian(
    guardianId: string,
    dependentId: string,
  ): Promise<IssuedLinkCode> {
    const former = await this.prisma.guardianships.findFirst({
      where: {
        guardian_user_id: guardianId,
        dependent_user_id: dependentId,
        revoked_reason: 'released',
        consent_status: 'revoked',
      },
      select: { guardianship_id: true },
    });
    if (!former) {
      throw new AppNotFoundException(ErrorCode.GUARDIANSHIP_NOT_FOUND);
    }
    await this.assertClaimable(dependentId);
    return this.mint(guardianId, dependentId, null, 'former_guardian');
  }

  /**
   * The permission (`club_members:approve` on the section) is enforced by the
   * controller. Only a custody-origin person (the club held them) or one with
   * no former guardian user can be handed over by a director.
   */
  async issueForDirector(
    directorId: string,
    clubSectionId: number,
    dependentId: string,
  ): Promise<IssuedLinkCode> {
    const inSection = await hasLiveAssignmentInSection(
      this.prisma,
      dependentId,
      clubSectionId,
    );
    if (!inSection) {
      throw new AppNotFoundException(ErrorCode.GUARDIANSHIP_NOT_FOUND);
    }
    const released = await this.prisma.guardianships.findMany({
      where: { dependent_user_id: dependentId, revoked_reason: 'released' },
      select: { is_custodian: true, guardian_user_id: true },
    });
    const custodyOrigin = released.some((row) => row.is_custodian);
    const hasFormerGuardianUser = released.some(
      (row) => row.guardian_user_id !== null,
    );
    if (!custodyOrigin && hasFormerGuardianUser) {
      // A family holds the code path: the director is not the right issuer.
      throw new AppNotFoundException(ErrorCode.GUARDIANSHIP_NOT_FOUND);
    }
    await this.assertClaimable(dependentId);
    return this.mint(directorId, dependentId, clubSectionId, 'director');
  }

  private async assertClaimable(dependentId: string): Promise<void> {
    const state = await adultClaimTargetState(this.prisma, dependentId);
    if (state === 'gone') {
      throw new AppNotFoundException(ErrorCode.GUARDIANSHIP_NOT_FOUND);
    }
    if (state !== 'claimable') throw notReleased();
  }

  private async mint(
    issuerId: string,
    dependentId: string,
    clubSectionId: number | null,
    issuerKind: 'former_guardian' | 'director',
  ): Promise<IssuedLinkCode> {
    const issued = await this.linkCodes.issueAdultClaimCode({
      dependentId,
      issuedBy: issuerId,
      clubSectionId,
    });
    await this.audit.recordEventOrThrow({
      entity_type: 'dependent_profile',
      entity_id: dependentId,
      action: 'family.adult_claim.issued',
      actor_user_id: issuerId,
      target_user_id: dependentId,
      // Never the code itself.
      changes: { expires_at: issued.expires_at, issuer: issuerKind },
    });
    return issued;
  }
}
