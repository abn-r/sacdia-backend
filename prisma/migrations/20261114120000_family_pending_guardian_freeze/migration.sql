-- Self-registered teens (13-17) without a verified guardian are FROZEN at day 90
-- but NEVER auto-deleted (ruling 2026-11-13, same spirit as Phase 4 R6).
-- Constraint rewrite + backfill; no DDL on tables, no data loss. Re-runnable.
-- Render runs `prisma migrate deploy` at the END OF THE BUILD.
--
-- A teen frozen by the pending-teen-guardian cron now carries
-- frozen_reason = 'pending_guardian' and NO purge_after; the purge cron skips the
-- reason permanently. The teen unfreezes as soon as a guardian is linked AND
-- verified; only the person can ask for deletion (DELETE /auth/me).
-- Club-custody minors (< 13, Phase 2 ruling A9) keep frozen_reason NULL and the
-- 90-day purge.

ALTER TABLE dependent_profiles DROP CONSTRAINT IF EXISTS dependent_profiles_frozen_reason_ck;
ALTER TABLE dependent_profiles ADD CONSTRAINT dependent_profiles_frozen_reason_ck
  CHECK (
    frozen_reason IS NULL
    OR (frozen_at IS NOT NULL AND frozen_reason IN ('majority_release', 'pending_guardian'))
  );

-- Pair rule by reason:
--   * not frozen: neither frozen_at nor purge_after;
--   * legacy freeze (reason NULL, custody minors): frozen_at AND purge_after;
--   * 'majority_release' / 'pending_guardian' freeze: frozen_at and NO purge_after.
ALTER TABLE dependent_profiles DROP CONSTRAINT IF EXISTS dependent_profiles_frozen_ck;
ALTER TABLE dependent_profiles ADD CONSTRAINT dependent_profiles_frozen_ck
  CHECK (
    (frozen_at IS NULL AND purge_after IS NULL)
    OR (frozen_at IS NOT NULL AND frozen_reason IS NULL AND purge_after IS NOT NULL)
    -- frozen_reason IS NOT NULL is required: with a NULL reason the IN test is
    -- UNKNOWN, and a CHECK treats UNKNOWN as PASS (legacy freeze w/o purge_after).
    OR (
      frozen_at IS NOT NULL
      AND frozen_reason IS NOT NULL
      AND frozen_reason IN ('majority_release', 'pending_guardian')
      AND purge_after IS NULL
    )
  );

-- Backfill 1: teens the cron already froze. The cron's exact fingerprint is a
-- supervised login disabled with reason 'unlinked_purged' on a still-frozen,
-- not-purged profile of an account holder. Rows already purged, custody minors
-- (no account) and reasoned freezes are never touched. One statement sets both
-- columns, so the pair CHECK holds.
UPDATE dependent_profiles dp
   SET frozen_reason = 'pending_guardian',
       purge_after = NULL
 WHERE dp.frozen_at IS NOT NULL
   AND dp.frozen_reason IS NULL
   AND dp.purged_at IS NULL
   AND EXISTS (
     SELECT 1 FROM supervised_logins sl
      WHERE sl.user_id = dp.user_id AND sl.disabled_reason = 'unlinked_purged'
   )
   AND EXISTS (
     SELECT 1 FROM accounts a WHERE a.user_id = dp.user_id
   );

-- Backfill 2: the cron used to disable the login of those teens, which blocked
-- them at sign-in. A pending_guardian teen must be able to log in (see the
-- status, link a guardian, delete the account), so the cron's disable is lifted.
UPDATE supervised_logins sl
   SET disabled_at = NULL,
       disabled_reason = NULL,
       disabled_by_user_id = NULL
 WHERE sl.disabled_reason = 'unlinked_purged'
   AND EXISTS (
     SELECT 1 FROM dependent_profiles dp
      WHERE dp.user_id = sl.user_id
        AND dp.frozen_reason = 'pending_guardian'
        AND dp.purged_at IS NULL
   );

-- Rollback (only while no pending_guardian row exists, or after re-dating them):
--   UPDATE dependent_profiles SET frozen_reason = NULL, purge_after = now() + interval '90 days' WHERE frozen_reason = 'pending_guardian';
--   ALTER TABLE dependent_profiles DROP CONSTRAINT IF EXISTS dependent_profiles_frozen_ck;
--   ALTER TABLE dependent_profiles ADD CONSTRAINT dependent_profiles_frozen_ck CHECK ((frozen_at IS NULL AND purge_after IS NULL) OR (frozen_at IS NOT NULL AND frozen_reason IS NULL AND purge_after IS NOT NULL) OR (frozen_at IS NOT NULL AND frozen_reason IS NOT NULL AND frozen_reason = 'majority_release' AND purge_after IS NULL));
--   ALTER TABLE dependent_profiles DROP CONSTRAINT IF EXISTS dependent_profiles_frozen_reason_ck;
--   ALTER TABLE dependent_profiles ADD CONSTRAINT dependent_profiles_frozen_reason_ck CHECK (frozen_reason IS NULL OR (frozen_at IS NOT NULL AND frozen_reason IN ('majority_release')));
