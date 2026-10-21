import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { displayName } from '../guardianships/guardianship-queries';
import {
  assertAssignmentActivationAllowed,
  findMinorsForActivation,
} from './assignment-activation-gate';
import {
  CUSTODY_TRIGGER_REASONS,
  consentHasVerifyWork,
  custodyBarredUserIds,
  evaluateConsentVerifier,
  type ViewerVerifyBlock,
} from './consent-four-eyes';

type Db = Prisma.TransactionClient | PrismaService;

/**
 * The guardianship rows the consent block reads: real (never test data) and not
 * revoked. Both the block and the verify-work lookup start from these.
 */
const LIVE_REAL_GUARDIANSHIP_WHERE = {
  is_test_data: false,
  consent_status: { not: 'revoked' },
} satisfies Prisma.guardianshipsWhereInput;

/** The CURRENT signed form of a row: not superseded, not purged. */
const CURRENT_FORM_WHERE = {
  superseded_at: null,
  purged_at: null,
} satisfies Prisma.guardianship_consent_evidencesWhereInput;

/**
 * A dependent's consent as the membership workflow sees it. `verifiedAt` is the
 * most recent verification of a real (non-test, non-revoked) guardianship row,
 * or null while the consent is still pending.
 */
export interface DependentConsentState {
  verifiedAt: Date | null;
}

/** Who answers for a dependent, as the director sees it (no contact data). */
export interface ConsentBlockGuardian {
  display_name: string;
  relationship_type_name: string | null;
  is_primary: boolean;
}

/**
 * The `consent` block of a pending membership request that belongs to a minor
 * (FP-72; Phase 3a extends it to every user under the age of majority). Adults
 * get `null` instead.
 */
export interface ConsentBlock {
  required: true;
  /**
   * true for a user with a dependent profile; false for a self-registered teen
   * who has none yet (nobody linked, so there is nothing to verify).
   */
  dependent: boolean;
  /** A non-custodian guardian (pending or verified) is linked. */
  guardian_linked: boolean;
  /** The row verify-consent acts on (active primary); null when there is none. */
  guardianship_id: string | null;
  status: 'pending' | 'verified';
  evidence_uploaded: boolean;
  guardians: ConsentBlockGuardian[];
  /**
   * May the CURRENT viewer (the caller of the list) verify this consent right
   * now, by the same four-eyes predicate `verify-consent` enforces
   * ({@link evaluateConsentVerifier}). Exact semantics:
   *  - `true` only when there is something to verify (the dependent has an
   *    active primary guardianship that is still `pending` AND a current signed
   *    form was uploaded) and the viewer is not barred: not a live guardian of
   *    the child (any row), and, for club custody, not the uploader of the
   *    current form, the creator of the dependent nor the guardian who handed
   *    the child over;
   *  - `false` when the viewer is barred (see `viewer_verify_block`) OR when
   *    there is nothing to verify (no form uploaded yet, already verified, no
   *    primary row, or a self-registered teen nobody has linked);
   *  - it says nothing about permissions (`consent:verify` /
   *    `club_members:approve`): the list already needs one of them, and both
   *    allow verify-consent on the same section. A viewer with only
   *    `consent:verify` gets a list filtered to the rows that have something to
   *    verify (see MembershipRequestsService.listPending `verifyOnly`);
   *    barred viewers keep those rows.
   * The block is a hint for the UI; `verify-consent` stays the authority (403).
   */
  viewer_can_verify: boolean;
  /**
   * Why the viewer is barred: `self_guardian` (a live guardian of the child),
   * `self_custodian` (custody and the viewer created the minor, uploaded the
   * current form or handed the child over). `null` when the viewer may verify
   * and when there is nothing to verify. No user id is ever exposed.
   */
  viewer_verify_block: ViewerVerifyBlock | null;
}

/**
 * Parental-consent rules of the membership workflow (family-profiles, FP-39/40;
 * Phase 3a FP3-01).
 *
 * Every MINOR is gated: a user with a `dependent_profiles` row, anyone under
 * the age of majority of their country, and anyone without a birthday (fail
 * closed). Adults are unaffected.
 *
 * Rows with `is_test_data` never count as consent (FP-03), and a revoked row is
 * never `verified` (DB check `guardianships_revoked_ck`).
 */
@Injectable()
export class ConsentGateService {
  /**
   * Throws 409 MR_CONSENT_NOT_VERIFIED when the user is a dependent without a
   * verified guardianship. Call it INSIDE the approving transaction so a
   * consent revoked between listing and approving blocks the approval; for a
   * dependent it takes the per-dependent lock (serialized with verify/revoke).
   * Same rule as every other activation path: {@link assertAssignmentActivationAllowed}.
   */
  async assertApprovable(
    tx: Prisma.TransactionClient,
    userId: string,
  ): Promise<void> {
    await assertAssignmentActivationAllowed(tx, userId);
  }

  /**
   * Consent state of every minor among `userIds` (dependent profile or under
   * the age of majority) in a few queries. Adults are absent from the result.
   */
  async loadDependentConsent(
    db: Db,
    userIds: string[],
  ): Promise<Map<string, DependentConsentState>> {
    const states = new Map<string, DependentConsentState>();
    if (userIds.length === 0) return states;

    const minors = await findMinorsForActivation(db, userIds);
    if (minors.size === 0) return states;

    for (const userId of minors.keys()) {
      states.set(userId, { verifiedAt: null });
    }

    const verifiedRows = await db.guardianships.findMany({
      where: {
        dependent_user_id: { in: [...minors.keys()] },
        consent_status: 'verified',
        is_test_data: false,
      },
      select: { dependent_user_id: true, verified_at: true },
    });
    for (const row of verifiedRows) {
      const state = states.get(row.dependent_user_id);
      if (!state || !row.verified_at) continue;
      if (!state.verifiedAt || row.verified_at > state.verifiedAt) {
        state.verifiedAt = row.verified_at;
      }
    }

    return states;
  }
  /**
   * The `consent` block of every minor among `userIds` in a fixed number of
   * queries, however many requests are listed (no N+1). Adults are absent from
   * the result. `status` follows the approve gate: verified
   * only when a real (non-test, non-revoked) row is verified. `viewerId` is the
   * caller: it drives `viewer_can_verify` / `viewer_verify_block` (the extra
   * reads are batched too and skipped when no request has a form to verify).
   */
  async loadConsentBlocks(
    db: Db,
    userIds: string[],
    viewerId: string,
  ): Promise<Map<string, ConsentBlock>> {
    const blocks = new Map<string, ConsentBlock>();
    if (userIds.length === 0) return blocks;

    const minors = await findMinorsForActivation(db, userIds);
    if (minors.size === 0) return blocks;

    // Only users with a dependent profile can have guardianship rows to show.
    const withProfile = [...minors.entries()]
      .filter(([, minor]) => minor.hasDependentProfile)
      .map(([userId]) => userId);

    // A self-registered teen nobody has linked yet: nothing to verify.
    for (const [userId, minor] of minors) {
      if (minor.hasDependentProfile) continue;
      blocks.set(userId, {
        required: true,
        dependent: false,
        guardian_linked: false,
        guardianship_id: null,
        status: 'pending',
        evidence_uploaded: false,
        guardians: [],
        viewer_can_verify: false,
        viewer_verify_block: null,
      });
    }
    if (withProfile.length === 0) return blocks;

    const rows = await db.guardianships.findMany({
      where: {
        dependent_user_id: { in: withProfile },
        ...LIVE_REAL_GUARDIANSHIP_WHERE,
      },
      orderBy: { created_at: 'asc' },
      select: {
        guardianship_id: true,
        dependent_user_id: true,
        is_primary: true,
        is_custodian: true,
        consent_status: true,
        external_name: true,
        relationship_type: { select: { name: true } },
        guardian: { select: { name: true, paternal_last_name: true } },
        custodian_club: { select: { name: true } },
        consent_evidences: {
          where: CURRENT_FORM_WHERE,
          select: { evidence_id: true, uploaded_by_user_id: true },
          take: 1,
        },
        dependent: {
          select: {
            dependent_profile: { select: { created_by_user_id: true } },
          },
        },
      },
    });

    const verifyFacts = await this.loadVerifyFacts(db, rows, viewerId);

    for (const user_id of withProfile) {
      const own = rows
        .filter((row) => row.dependent_user_id === user_id)
        // Primary first, then oldest first (rows come ordered by created_at).
        .sort((a, b) => Number(b.is_primary) - Number(a.is_primary));
      const primary = own.find((row) => row.is_primary);
      const verdict = evaluateConsentVerifier({
        viewerId,
        hasPrimary: primary !== undefined,
        consentStatus: primary?.consent_status ?? 'pending',
        evidenceUploaded: (primary?.consent_evidences.length ?? 0) > 0,
        viewerIsLiveGuardian: verifyFacts.viewerGuardianOf.has(user_id),
        custody: primary?.is_custodian ?? false,
        custodyBarredUserIds: custodyBarredUserIds({
          evidenceUploaderId:
            primary?.consent_evidences[0]?.uploaded_by_user_id,
          creatorId: primary?.dependent.dependent_profile?.created_by_user_id,
          handedOverGuardianId: verifyFacts.handedOverBy.get(user_id),
        }),
      });
      blocks.set(user_id, {
        required: true,
        dependent: true,
        guardian_linked: own.some((row) => !row.is_custodian),
        guardianship_id: primary?.guardianship_id ?? null,
        status: own.some((row) => row.consent_status === 'verified')
          ? 'verified'
          : 'pending',
        evidence_uploaded: (primary?.consent_evidences.length ?? 0) > 0,
        guardians: own.map((row) => ({
          display_name: row.is_custodian
            ? (row.custodian_club?.name ?? '')
            : row.guardian
              ? displayName(row.guardian)
              : (row.external_name ?? ''),
          relationship_type_name: row.relationship_type?.name ?? null,
          is_primary: row.is_primary,
        })),
        ...verdict,
      });
    }
    return blocks;
  }

  /**
   * The users among `userIds` whose consent is waiting for a reviewer RIGHT
   * NOW, whoever the reviewer is, mapped to the upload time of the current
   * signed form (how long it has been waiting). Exactly the users whose
   * consent block (loadConsentBlocks) has something to verify, i.e.
   * verdictHasVerifyWork(block): a dependent profile, an active primary row
   * (the first live real primary, as the block picks it) that is still
   * `pending`, and a current form; decided by the same
   * {@link consentHasVerifyWork} predicate. Viewer-independent: a viewer barred
   * by four-eyes still has the work listed (with the block saying why).
   *
   * Lighter than the block (no guardians, names or four-eyes facts) so a
   * coordinator queue can rank every candidate and read only the page in full.
   * Bounded however many users: the minors lookup (findMinorsForActivation:
   * one users read plus one age-policy read per distinct country) and ONE
   * guardianships read; none for no users.
   */
  async loadVerifyWorkSince(
    db: Db,
    userIds: string[],
  ): Promise<Map<string, Date>> {
    const waiting = new Map<string, Date>();
    if (userIds.length === 0) return waiting;

    const minors = await findMinorsForActivation(db, userIds);
    const withProfile = [...minors.entries()]
      .filter(([, minor]) => minor.hasDependentProfile)
      .map(([userId]) => userId);
    if (withProfile.length === 0) return waiting;

    const primaries = await db.guardianships.findMany({
      where: {
        dependent_user_id: { in: withProfile },
        is_primary: true,
        ...LIVE_REAL_GUARDIANSHIP_WHERE,
      },
      orderBy: { created_at: 'asc' },
      select: {
        dependent_user_id: true,
        consent_status: true,
        consent_evidences: {
          where: CURRENT_FORM_WHERE,
          orderBy: { uploaded_at: 'desc' },
          select: { uploaded_at: true },
          take: 1,
        },
      },
    });

    // Rows come oldest first: the first primary per dependent is the block's
    // primary. Indexed once so the loop below is O(users + primaries).
    const primaryOf = new Map<string, (typeof primaries)[number]>();
    for (const row of primaries) {
      if (!primaryOf.has(row.dependent_user_id)) {
        primaryOf.set(row.dependent_user_id, row);
      }
    }

    for (const userId of withProfile) {
      const primary = primaryOf.get(userId);
      const form = primary?.consent_evidences[0];
      if (
        consentHasVerifyWork({
          hasPrimary: primary !== undefined,
          consentStatus: primary?.consent_status ?? 'pending',
          evidenceUploaded: form !== undefined,
        }) &&
        form
      ) {
        waiting.set(userId, form.uploaded_at);
      }
    }
    return waiting;
  }

  /**
   * The facts the four-eyes verdict needs beyond the page rows, for the
   * dependents that have a pending primary row WITH a current form (the only
   * ones where the verdict can be anything but "nothing to verify"):
   *  - which of them the viewer is a live guardian of (any non-revoked row, test
   *    data included, exactly what verify-consent counts);
   *  - for the custody ones, the guardian who handed the child over (the latest
   *    hand-over, as verify-consent reads it).
   * One query each however many requests; none when no request qualifies.
   */
  private async loadVerifyFacts(
    db: Db,
    pageRows: Array<{
      dependent_user_id: string;
      is_primary: boolean;
      is_custodian: boolean;
      consent_status: string;
      consent_evidences: unknown[];
    }>,
    viewerId: string,
  ): Promise<{
    viewerGuardianOf: Set<string>;
    handedOverBy: Map<string, string>;
  }> {
    const candidates = pageRows.filter(
      (row) =>
        row.is_primary &&
        row.consent_status === 'pending' &&
        row.consent_evidences.length > 0,
    );
    const viewerGuardianOf = new Set<string>();
    const handedOverBy = new Map<string, string>();
    if (candidates.length === 0) return { viewerGuardianOf, handedOverBy };

    const candidateIds = candidates.map((row) => row.dependent_user_id);
    const custodyIds = candidates
      .filter((row) => row.is_custodian)
      .map((row) => row.dependent_user_id);

    const [viewerRows, handovers] = await Promise.all([
      db.guardianships.findMany({
        where: {
          dependent_user_id: { in: candidateIds },
          guardian_user_id: viewerId,
          consent_status: { not: 'revoked' },
        },
        select: { dependent_user_id: true },
      }),
      custodyIds.length === 0
        ? Promise.resolve([])
        : db.guardianships.findMany({
            where: {
              dependent_user_id: { in: custodyIds },
              is_custodian: false,
              guardian_user_id: { not: null },
              consent_status: 'revoked',
              revoked_reason: { in: [...CUSTODY_TRIGGER_REASONS] },
            },
            orderBy: { revoked_at: 'desc' },
            select: { dependent_user_id: true, guardian_user_id: true },
          }),
    ]);

    for (const row of viewerRows) viewerGuardianOf.add(row.dependent_user_id);
    for (const row of handovers) {
      // Rows come latest hand-over first: keep the first per dependent.
      if (row.guardian_user_id && !handedOverBy.has(row.dependent_user_id)) {
        handedOverBy.set(row.dependent_user_id, row.guardian_user_id);
      }
    }
    return { viewerGuardianOf, handedOverBy };
  }
}
