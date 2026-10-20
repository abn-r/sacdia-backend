import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { displayName } from '../guardianships/guardianship-queries';
import {
  assertAssignmentActivationAllowed,
  findMinorsForActivation,
} from './assignment-activation-gate';

type Db = Prisma.TransactionClient | PrismaService;

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
   * only when a real (non-test, non-revoked) row is verified.
   */
  async loadConsentBlocks(
    db: Db,
    userIds: string[],
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
      });
    }
    if (withProfile.length === 0) return blocks;

    const rows = await db.guardianships.findMany({
      where: {
        dependent_user_id: { in: withProfile },
        is_test_data: false,
        consent_status: { not: 'revoked' },
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
          where: { superseded_at: null, purged_at: null },
          select: { evidence_id: true },
          take: 1,
        },
      },
    });

    for (const user_id of withProfile) {
      const own = rows
        .filter((row) => row.dependent_user_id === user_id)
        // Primary first, then oldest first (rows come ordered by created_at).
        .sort((a, b) => Number(b.is_primary) - Number(a.is_primary));
      const primary = own.find((row) => row.is_primary);
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
      });
    }
    return blocks;
  }
}
