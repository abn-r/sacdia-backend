import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AppConflictException } from '../common/errors/app.exception';
import { ErrorCode } from '../common/errors/error-codes';
import { displayName } from '../guardianships/guardianship-queries';

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
 * The `consent` block of a pending membership request that belongs to a
 * dependent (FP-72). Adults get `null` instead.
 */
export interface ConsentBlock {
  required: true;
  dependent: true;
  /** The row verify-consent acts on (active primary); null when there is none. */
  guardianship_id: string | null;
  status: 'pending' | 'verified';
  evidence_uploaded: boolean;
  guardians: ConsentBlockGuardian[];
}

/**
 * Parental-consent rules of the membership workflow (family-profiles, FP-39/40).
 *
 * Only DEPENDENTS (users with a `dependent_profiles` row) are gated. Everybody
 * else, including self-registered teenagers, is unaffected.
 *
 * Rows with `is_test_data` never count as consent (FP-03), and a revoked row is
 * never `verified` (DB check `guardianships_revoked_ck`).
 */
@Injectable()
export class ConsentGateService {
  /**
   * Throws 409 MR_CONSENT_NOT_VERIFIED when the user is a dependent without a
   * verified guardianship. Call it INSIDE the approving transaction so a
   * consent revoked between listing and approving blocks the approval.
   */
  async assertApprovable(db: Db, userId: string): Promise<void> {
    const profile = await db.dependent_profiles.findUnique({
      where: { user_id: userId },
      select: { user_id: true },
    });
    if (!profile) return;

    const verified = await db.guardianships.findFirst({
      where: {
        dependent_user_id: userId,
        consent_status: 'verified',
        is_test_data: false,
      },
      select: { guardianship_id: true },
    });
    if (!verified) {
      throw new AppConflictException(ErrorCode.MR_CONSENT_NOT_VERIFIED);
    }
  }

  /**
   * Consent state of every dependent among `userIds` in two queries. Users that
   * are not dependents are absent from the result.
   */
  async loadDependentConsent(
    db: Db,
    userIds: string[],
  ): Promise<Map<string, DependentConsentState>> {
    const states = new Map<string, DependentConsentState>();
    if (userIds.length === 0) return states;

    const profiles = await db.dependent_profiles.findMany({
      where: { user_id: { in: userIds } },
      select: { user_id: true },
    });
    if (profiles.length === 0) return states;

    for (const { user_id } of profiles) {
      states.set(user_id, { verifiedAt: null });
    }

    const verifiedRows = await db.guardianships.findMany({
      where: {
        dependent_user_id: { in: profiles.map((p) => p.user_id) },
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
   * The `consent` block of every dependent among `userIds` in TWO queries,
   * however many requests are listed (no N+1). Users that are not dependents
   * are absent from the result. `status` follows the approve gate: verified
   * only when a real (non-test, non-revoked) row is verified.
   */
  async loadConsentBlocks(
    db: Db,
    userIds: string[],
  ): Promise<Map<string, ConsentBlock>> {
    const blocks = new Map<string, ConsentBlock>();
    if (userIds.length === 0) return blocks;

    const profiles = await db.dependent_profiles.findMany({
      where: { user_id: { in: userIds } },
      select: { user_id: true },
    });
    if (profiles.length === 0) return blocks;

    const rows = await db.guardianships.findMany({
      where: {
        dependent_user_id: { in: profiles.map((profile) => profile.user_id) },
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

    for (const { user_id } of profiles) {
      const own = rows
        .filter((row) => row.dependent_user_id === user_id)
        // Primary first, then oldest first (rows come ordered by created_at).
        .sort((a, b) => Number(b.is_primary) - Number(a.is_primary));
      const primary = own.find((row) => row.is_primary);
      blocks.set(user_id, {
        required: true,
        dependent: true,
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
