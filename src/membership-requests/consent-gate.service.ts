import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AppConflictException } from '../common/errors/app.exception';
import { ErrorCode } from '../common/errors/error-codes';

type Db = Prisma.TransactionClient | PrismaService;

/**
 * A dependent's consent as the membership workflow sees it. `verifiedAt` is the
 * most recent verification of a real (non-test, non-revoked) guardianship row,
 * or null while the consent is still pending.
 */
export interface DependentConsentState {
  verifiedAt: Date | null;
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
}
