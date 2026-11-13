import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { RELEASE_THAWABLE_FROZEN_REASONS } from './guardianships.constants';

export interface ReleaseCompletionResult {
  /** The release is complete after this call (accepted AND email on file). */
  completed: boolean;
  /** This call lifted a majority-release freeze (ruling R1 thaw). */
  thawed: boolean;
}

/**
 * Closes a majority release (Phase 4). A released adult COMPLETES the release
 * when BOTH hold: they accepted the fresh terms (`release_accepted_at`) and
 * `users.email` is NOT NULL (ruling R5: an UNVERIFIED email is enough). At that
 * point they return to the ordinary `user` principal.
 *
 * Ruling R1 (THAW) + R6: a person frozen by the release
 * (`frozen_reason = 'majority_release'`) completes the same way and is
 * unfrozen: `frozen_at`, `purge_after` and `frozen_reason` are cleared. The same
 * goes for a teen paused as `pending_guardian` (ruling 2026-11-13) who reached
 * the age of majority: no guardian is needed anymore. A
 * legacy freeze (`frozen_reason` NULL, a minor frozen for lack of a guardian)
 * is NEVER thawed here.
 *
 * Runs inside the caller's transaction (accept / add email). The caller must
 * `ActingForCache.bump(userId)` AFTER the commit when `completed` is true.
 */
@Injectable()
export class ReleaseCompletionService {
  constructor(private readonly audit: AuditLogsService) {}

  async tryComplete(
    tx: Prisma.TransactionClient,
    userId: string,
    now: Date = new Date(),
  ): Promise<ReleaseCompletionResult> {
    const profile = await tx.dependent_profiles.findUnique({
      where: { user_id: userId },
      select: {
        purged_at: true,
        frozen_at: true,
        frozen_reason: true,
        release_accepted_at: true,
        release_completed_at: true,
      },
    });
    if (
      !profile ||
      profile.purged_at ||
      profile.release_completed_at ||
      !profile.release_accepted_at
    ) {
      return { completed: false, thawed: false };
    }
    const legacyFreeze =
      profile.frozen_at !== null &&
      !(RELEASE_THAWABLE_FROZEN_REASONS as readonly (string | null)[]).includes(
        profile.frozen_reason,
      );
    if (legacyFreeze) {
      return { completed: false, thawed: false };
    }

    const user = await tx.users.findUnique({
      where: { user_id: userId },
      select: { email: true },
    });
    if (!user?.email) {
      return { completed: false, thawed: false };
    }

    const thaw = profile.frozen_at !== null;
    const { count } = await tx.dependent_profiles.updateMany({
      where: {
        user_id: userId,
        purged_at: null,
        release_completed_at: null,
        release_accepted_at: { not: null },
        OR: [
          { frozen_at: null },
          { frozen_reason: { in: [...RELEASE_THAWABLE_FROZEN_REASONS] } },
        ],
      },
      data: {
        release_completed_at: now,
        ...(thaw
          ? { frozen_at: null, purge_after: null, frozen_reason: null }
          : {}),
      },
    });
    if (count === 0) {
      return { completed: false, thawed: false };
    }

    await this.audit.recordEventOrThrow(
      {
        entity_type: 'dependent_profile',
        entity_id: userId,
        action: 'family.release.completed',
        actor_user_id: userId,
        target_user_id: userId,
        changes: { thawed: thaw },
      },
      tx,
    );
    if (thaw) {
      await this.audit.recordEventOrThrow(
        {
          entity_type: 'dependent_profile',
          entity_id: userId,
          action: 'family.release.thawed',
          actor_user_id: userId,
          target_user_id: userId,
        },
        tx,
      );
    }
    return { completed: true, thawed: thaw };
  }
}
