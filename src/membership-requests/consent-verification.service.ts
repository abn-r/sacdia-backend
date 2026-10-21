import { Injectable, Logger } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import {
  getAuditCorrelationId,
  markExplicitAuditRecorded,
} from '../audit-logs/audit-request-context';
import { ActingForCache } from '../auth/acting-for/acting-for.cache';
import {
  AppBadRequestException,
  AppConflictException,
  AppException,
  AppForbiddenException,
  AppNotFoundException,
} from '../common/errors/app.exception';
import { ErrorCode } from '../common/errors/error-codes';
import { GuardianNotificationsService } from '../guardianships/guardian-notifications.service';
import {
  NOT_REVOKED,
  findSectionAssignment,
  lockDependent,
} from '../guardianships/guardianship-queries';
import { PrismaService } from '../prisma/prisma.service';
import {
  CUSTODY_TRIGGER_REASONS,
  consentHasVerifyWork,
  custodyBarredUserIds,
  findVerifierBlock,
  verifierBlockErrorCode,
} from './consent-four-eyes';
import type { VerifyConsentDto } from './dto';
import { MembershipRequestsService } from './membership-requests.service';

export interface VerifiedGuardianship {
  guardianship_id: string;
  consent_status: 'verified';
  verified_at: string;
  verified_by_user_id: string | null;
  verification_method: string | null;
}

export interface VerifyConsentResult {
  guardianship: VerifiedGuardianship;
  /**
   * The approved request when `approve` was asked and succeeded, else null.
   * Always null when the assignment was already active (verify-only).
   */
  assignment: unknown;
  /**
   * Set when `approve` was asked and approving failed AFTER the consent was
   * committed: the code of the failure. The consent stays verified and
   * calling verify-consent again retries only the approval.
   */
  approve_error: string | null;
}

export interface VerifyConsentOptions {
  /**
   * The caller is a verify-only reviewer (consent:verify without
   * club_members:approve in the section, e.g. a coordinator). They only act on
   * the requests of their filtered list (pending request, pending consent,
   * current form): anything else is 404 MR_NOT_FOUND, indistinguishable from
   * an unknown request, like the consent-evidence routes.
   */
  verifyOnly?: boolean;
  /**
   * The verifier reached the section through the coordinator path (the guard's
   * `coordinatorSectionGrant`), not through a club role. Records the
   * verification as `coordinator_paper_form` instead of `director_paper_form`.
   */
  viaCoordinator?: boolean;
}

/** `guardianships.verification_method` for a paper form verified by a club role. */
export const VERIFICATION_METHOD_DIRECTOR_PAPER_FORM = 'director_paper_form';
/** `guardianships.verification_method` for a paper form verified by a coordinator. */
export const VERIFICATION_METHOD_COORDINATOR_PAPER_FORM =
  'coordinator_paper_form';

const VERIFY_ROW_SELECT = {
  guardianship_id: true,
  dependent_user_id: true,
  guardian_user_id: true,
  is_custodian: true,
  consent_status: true,
  verification_method: true,
  verified_at: true,
  verified_by_user_id: true,
  consent_evidences: {
    where: { superseded_at: null, purged_at: null },
    select: { evidence_id: true, uploaded_by_user_id: true },
    take: 1,
  },
  dependent: {
    select: {
      dependent_profile: { select: { created_by_user_id: true } },
    },
  },
} satisfies Prisma.guardianshipsSelect;

type VerifyRow = Prisma.guardianshipsGetPayload<{
  select: typeof VERIFY_ROW_SELECT;
}>;

interface VerifyTransactionResult {
  dependentUserId: string;
  row: VerifiedGuardianship;
  /** Consent flipped to verified in THIS call (drives the side effects). */
  newlyVerified: boolean;
  /** Set when the request was already approved by an earlier identical call. */
  alreadyApproved: unknown;
  /**
   * The assignment was ALREADY active (a teen who joined before Phase 3): the
   * consent is verified and there is nothing to approve.
   */
  verifyOnly?: boolean;
}

/**
 * The director verifies a minor's consent after reviewing the signed paper form
 * (FP-73). One transaction, serialized per dependent with the same advisory lock
 * as revoke/leave/upload:
 *
 *  - the request must be a pending one of the section in the path, OR an
 *    already ACTIVE one whose consent is still pending (a minor who joined
 *    before the age-based gate existed): that case only verifies, it approves
 *    nothing (`assignment: null`);
 *  - the consent lives on the dependent's ACTIVE PRIMARY row (guardian or club
 *    custody); with no such row nothing is written (no orphan verified row);
 *  - a current signed form must exist (409 GUARDIANSHIP_EVIDENCE_REQUIRED);
 *  - four-eyes for EVERY row (verify 2c W2): a live guardian of the child cannot
 *    verify it (403 GUARDIANSHIP_GUARDIAN_SELF_VERIFY);
 *  - four-eyes for CUSTODY rows (ruling A14): the verifier cannot be the person
 *    who uploaded the current form, who created the dependent, or the guardian
 *    who handed the child over to the club (403 GUARDIANSHIP_CUSTODIAN_SELF_VERIFY);
 *  - invited guardians waiting on the verified row become verified too;
 *  - the audit row `guardianship.consent_verified` is written in the same
 *    transaction.
 *
 * After the commit: the acting-for epoch is bumped (the guardian's scopes
 * expand on the very next request), guardians are told, and when asked the
 * request is approved. A failing approval never undoes the consent.
 */
@Injectable()
export class ConsentVerificationService {
  private readonly logger = new Logger(ConsentVerificationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly actingForCache: ActingForCache,
    private readonly membershipRequests: MembershipRequestsService,
    private readonly guardianNotifications: GuardianNotificationsService,
  ) {}

  async verify(
    clubSectionId: number,
    assignmentId: string,
    verifierId: string,
    dto: VerifyConsentDto,
    options: VerifyConsentOptions = {},
  ): Promise<VerifyConsentResult> {
    if (dto.confirm_paper_form_reviewed !== true) {
      throw new AppBadRequestException(
        ErrorCode.MR_CONSENT_CONFIRMATION_REQUIRED,
      );
    }

    const outcome = await this.prisma.$transaction((tx) =>
      this.verifyInTransaction(
        tx,
        clubSectionId,
        assignmentId,
        verifierId,
        options.verifyOnly === true,
        options.viaCoordinator === true
          ? VERIFICATION_METHOD_COORDINATOR_PAPER_FORM
          : VERIFICATION_METHOD_DIRECTOR_PAPER_FORM,
      ),
    );

    if (outcome.newlyVerified) {
      // Epoch bump never throws; guardians learn about it best effort.
      await this.actingForCache.bump(outcome.dependentUserId);
      void this.guardianNotifications.onConsentVerified({
        dependentUserId: outcome.dependentUserId,
        verifierUserId: verifierId,
      });
    }

    const result: VerifyConsentResult = {
      guardianship: outcome.row,
      assignment: dto.approve === true ? outcome.alreadyApproved : null,
      approve_error: null,
    };
    if (
      dto.approve === true &&
      outcome.alreadyApproved === null &&
      !outcome.verifyOnly
    ) {
      try {
        result.assignment = await this.membershipRequests.approve(
          clubSectionId,
          assignmentId,
          verifierId,
        );
      } catch (error) {
        result.approve_error =
          error instanceof AppException
            ? error.code
            : ErrorCode.INTERNAL_SERVER_ERROR;
        this.logger.warn(
          `Consent verified but approving ${assignmentId} failed (${result.approve_error}): ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }
    return result;
  }

  private async verifyInTransaction(
    tx: Prisma.TransactionClient,
    clubSectionId: number,
    assignmentId: string,
    verifierId: string,
    verifyOnlyReviewer: boolean,
    verificationMethod: string,
  ): Promise<VerifyTransactionResult> {
    // The request decides WHICH dependent to lock; its state is re-read below.
    const probe = await findSectionAssignment(tx, clubSectionId, assignmentId);
    if (!probe || !probe.active) {
      throw new AppNotFoundException(ErrorCode.MR_NOT_FOUND);
    }
    const dependentId = probe.user_id;
    const profile = await tx.dependent_profiles.findUnique({
      where: { user_id: dependentId },
      select: { user_id: true },
    });
    if (!profile) {
      // Adults have no guardian consent to verify.
      throw new AppNotFoundException(
        verifyOnlyReviewer
          ? ErrorCode.MR_NOT_FOUND
          : ErrorCode.GUARDIANSHIP_NOT_FOUND,
      );
    }

    await lockDependent(tx, dependentId);

    const assignment = await findSectionAssignment(
      tx,
      clubSectionId,
      assignmentId,
    );
    if (!assignment || !assignment.active) {
      throw new AppNotFoundException(ErrorCode.MR_NOT_FOUND);
    }

    const row = await tx.guardianships.findFirst({
      where: {
        dependent_user_id: dependentId,
        is_primary: true,
        is_test_data: false,
        ...NOT_REVOKED,
      },
      select: VERIFY_ROW_SELECT,
    });
    if (
      verifyOnlyReviewer &&
      (assignment.status !== 'pending' ||
        !consentHasVerifyWork({
          hasPrimary: row !== null,
          consentStatus: row?.consent_status ?? '',
          evidenceUploaded: (row?.consent_evidences.length ?? 0) > 0,
        }))
    ) {
      // Outside the verify-only reviewer's filtered list: the same 404 as an
      // unknown request (no GUARDIANSHIP_NOT_FOUND / 409 / idempotent 200 that
      // would tell them what is behind it).
      throw new AppNotFoundException(ErrorCode.MR_NOT_FOUND);
    }
    if (!row) {
      // The last guardian left and nobody took over (or only test data): there
      // is nothing to verify. No row is written.
      throw new AppNotFoundException(ErrorCode.GUARDIANSHIP_NOT_FOUND);
    }

    // An ACTIVE assignment is accepted too: a minor who joined before the
    // consent gate covered their age keeps the membership and only needs the
    // consent verified (verify-only, nothing to approve).
    const verifyOnly = assignment.status === 'active';
    if (assignment.status !== 'pending' && !verifyOnly) {
      throw new AppConflictException(ErrorCode.MR_ALREADY_PENDING);
    }
    if (verifyOnly && row.consent_status === 'verified') {
      // A repeated call after the first one already approved the request is a
      // no-op success.
      return {
        dependentUserId: dependentId,
        row: this.toVerified(row),
        newlyVerified: false,
        alreadyApproved: await tx.club_role_assignments.findUnique({
          where: { assignment_id: assignmentId },
        }),
        verifyOnly: true,
      };
    }

    if (row.consent_status === 'verified') {
      return {
        dependentUserId: dependentId,
        row: this.toVerified(row),
        newlyVerified: false,
        alreadyApproved: null,
      };
    }

    const evidence = row.consent_evidences[0];
    if (!evidence) {
      throw new AppConflictException(ErrorCode.GUARDIANSHIP_EVIDENCE_REQUIRED);
    }
    await this.assertFourEyes(
      tx,
      row,
      dependentId,
      evidence.uploaded_by_user_id,
      verifierId,
    );

    const now = new Date();
    const updated = await tx.guardianships.updateMany({
      where: {
        guardianship_id: row.guardianship_id,
        consent_status: 'pending',
      },
      data: {
        consent_status: 'verified',
        verified_by_user_id: verifierId,
        verified_at: now,
        verification_method: verificationMethod,
        modified_at: now,
      },
    });
    if (updated.count === 0) {
      // Someone else verified or revoked it between our read and this write.
      throw new AppConflictException(ErrorCode.MR_ALREADY_PENDING);
    }

    const promoted = await this.promoteInvitees(
      tx,
      row.guardianship_id,
      row.guardian_user_id,
      now,
    );

    if (!row.is_custodian) {
      await this.syncSupervisedLogin(tx, dependentId);
    }

    await this.recordAudit(tx, {
      guardianshipId: row.guardianship_id,
      dependentId,
      verifierId,
      evidenceId: evidence.evidence_id,
      clubSectionId,
      assignmentId,
      custody: row.is_custodian,
      promoted,
      verificationMethod,
      at: now,
    });

    return {
      dependentUserId: dependentId,
      row: {
        guardianship_id: row.guardianship_id,
        consent_status: 'verified',
        verified_at: now.toISOString(),
        verified_by_user_id: verifierId,
        verification_method: verificationMethod,
      },
      newlyVerified: true,
      alreadyApproved: null,
      ...(verifyOnly ? { verifyOnly: true } : {}),
    };
  }

  /**
   * A real guardian's consent was just verified for a minor who HOLDS an
   * account (a teen): make sure the `supervised_logins` row exists (method
   * 'email', so the guardian can see, disable or reset it) and stop the
   * guardian-less clock. Idempotent. Club custody never reaches this: custody
   * is not a guardian, so a custody-only teen keeps running the clock.
   */
  private async syncSupervisedLogin(
    tx: Prisma.TransactionClient,
    dependentId: string,
  ): Promise<void> {
    const holdsAccount =
      (await tx.account.count({ where: { userId: dependentId } })) > 0;
    if (!holdsAccount) return;

    await tx.supervised_logins.createMany({
      data: [
        {
          user_id: dependentId,
          method: 'email',
          origin: 'self_registered',
          password_set_by: 'self',
          pending_since: null,
        },
      ],
      skipDuplicates: true,
    });
    await tx.supervised_logins.updateMany({
      where: { user_id: dependentId, pending_since: { not: null } },
      data: { pending_since: null, pending_reminder_level: 0 },
    });
  }

  /**
   * Four-eyes (verify 2c W2 + ruling A14), decided by the SAME pure predicate
   * the `consent` block of the request list shows the viewer
   * ({@link findVerifierBlock}), so the UI and this 403 never disagree:
   *  - every row: whoever answers for the child (any live guardianship: primary,
   *    secondary, invited, test data; a revoked one does not count) cannot
   *    verify it;
   *  - custody rows have no guardian user, so "the custodian" is whoever put
   *    the child there: the uploader of the current form, the creator of the
   *    dependent and the guardian who handed the child over. Another authorized
   *    person of the club (or an admin) must verify.
   * Reads are lazy: the hand-over is only looked up for a custody row of a
   * verifier who is not already blocked as a guardian.
   */
  private async assertFourEyes(
    tx: Prisma.TransactionClient,
    row: VerifyRow,
    dependentId: string,
    evidenceUploaderId: string,
    verifierId: string,
  ): Promise<void> {
    const ownRows = await tx.guardianships.count({
      where: {
        dependent_user_id: dependentId,
        guardian_user_id: verifierId,
        ...NOT_REVOKED,
      },
    });
    const viewerIsLiveGuardian = ownRows > 0;

    let barred: string[] = [];
    if (row.is_custodian && !viewerIsLiveGuardian) {
      const handedOver = await tx.guardianships.findFirst({
        where: {
          dependent_user_id: row.dependent_user_id,
          is_custodian: false,
          guardian_user_id: { not: null },
          consent_status: 'revoked',
          revoked_reason: { in: [...CUSTODY_TRIGGER_REASONS] },
        },
        orderBy: { revoked_at: 'desc' },
        select: { guardian_user_id: true },
      });
      barred = custodyBarredUserIds({
        evidenceUploaderId,
        creatorId: row.dependent.dependent_profile?.created_by_user_id,
        handedOverGuardianId: handedOver?.guardian_user_id,
      });
    }

    const block = findVerifierBlock({
      viewerId: verifierId,
      viewerIsLiveGuardian,
      custody: row.is_custodian,
      custodyBarredUserIds: barred,
    });
    if (block) throw new AppForbiddenException(verifierBlockErrorCode(block));
  }

  /**
   * A guardian invited through a link code while the row was still pending is
   * vouched for by the one who invited them: when that row becomes verified so
   * do they (transitively, a chain is at most 4 guardians long).
   */
  private async promoteInvitees(
    tx: Prisma.TransactionClient,
    verifiedGuardianshipId: string,
    verifiedGuardianUserId: string | null,
    at: Date,
  ): Promise<string[]> {
    const promoted: string[] = [];
    let frontier: Array<{ id: string; guardianUserId: string | null }> = [
      { id: verifiedGuardianshipId, guardianUserId: verifiedGuardianUserId },
    ];
    while (frontier.length > 0) {
      const next: typeof frontier = [];
      for (const parent of frontier) {
        const invitees = await tx.guardianships.findMany({
          where: {
            invited_by_guardianship_id: parent.id,
            consent_status: 'pending',
            is_test_data: false,
          },
          select: { guardianship_id: true, guardian_user_id: true },
        });
        for (const invitee of invitees) {
          await tx.guardianships.update({
            where: { guardianship_id: invitee.guardianship_id },
            data: {
              consent_status: 'verified',
              verification_method: 'guardian_invite',
              verified_at: at,
              verified_by_user_id: parent.guardianUserId,
              modified_at: at,
            },
          });
          promoted.push(invitee.guardianship_id);
          next.push({
            id: invitee.guardianship_id,
            guardianUserId: invitee.guardian_user_id,
          });
        }
      }
      frontier = next;
    }
    return promoted;
  }

  /**
   * Written with the SAME transaction client so the verification and its audit
   * row commit or roll back together.
   */
  private async recordAudit(
    tx: Prisma.TransactionClient,
    input: {
      guardianshipId: string;
      dependentId: string;
      verifierId: string;
      evidenceId: string;
      clubSectionId: number;
      assignmentId: string;
      custody: boolean;
      promoted: string[];
      verificationMethod: string;
      at: Date;
    },
  ): Promise<void> {
    // The domain row replaces the generic HTTP one for this request.
    markExplicitAuditRecorded();
    await tx.audit_logs.create({
      data: {
        entity_type: 'guardianship',
        entity_id: input.guardianshipId,
        action: 'consent_verified',
        actor_user_id: input.verifierId,
        actor_kind: 'user',
        target_user_id: input.dependentId,
        summary:
          input.verificationMethod ===
          VERIFICATION_METHOD_COORDINATOR_PAPER_FORM
            ? 'Consentimiento del tutor verificado por el coordinador'
            : 'Consentimiento del tutor verificado por el director',
        changes: {
          verification_method: input.verificationMethod,
          evidence_id: input.evidenceId,
          club_section_id: input.clubSectionId,
          assignment_id: input.assignmentId,
          custody: input.custody,
          promoted_guardianship_ids: input.promoted,
        },
        result: 'succeeded',
        source: 'service',
        correlation_id: getAuditCorrelationId() ?? null,
        effective_at: input.at,
      },
    });
  }

  private toVerified(row: VerifyRow): VerifiedGuardianship {
    return {
      guardianship_id: row.guardianship_id,
      consent_status: 'verified',
      verified_at: (row.verified_at ?? new Date(0)).toISOString(),
      verified_by_user_id: row.verified_by_user_id,
      verification_method: row.verification_method,
    };
  }
}
