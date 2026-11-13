-- Phase 4 (release at majority): release lifecycle columns on dependent_profiles.
-- Additive + constraint/index creation only; no DML. Behind the flag
-- FAMILY_MAJORITY_RELEASE_ENABLED (default off) nothing reads these columns.
-- Render runs `prisma migrate deploy` at the END OF THE BUILD; re-runnable.
-- Partial indexes are SQL-only (Prisma cannot express them).
--
-- frozen_at / purge_after / purged_at already exist (Phase 2) and are REUSED:
--   * legacy freezes keep frozen_reason NULL;
--   * a majority-release freeze sets frozen_reason = 'majority_release' and
--     NEVER sets purge_after (ruling R6: released adults are never auto-purged;
--     the purge cron skips frozen_reason = 'majority_release' permanently).

ALTER TABLE dependent_profiles ADD COLUMN IF NOT EXISTS majority_notice_sent_at timestamptz(6);
ALTER TABLE dependent_profiles ADD COLUMN IF NOT EXISTS released_at timestamptz(6);
ALTER TABLE dependent_profiles ADD COLUMN IF NOT EXISTS release_deadline_at timestamptz(6);
ALTER TABLE dependent_profiles ADD COLUMN IF NOT EXISTS release_source varchar(16);
ALTER TABLE dependent_profiles ADD COLUMN IF NOT EXISTS release_accepted_at timestamptz(6);
ALTER TABLE dependent_profiles ADD COLUMN IF NOT EXISTS release_completed_at timestamptz(6);
ALTER TABLE dependent_profiles ADD COLUMN IF NOT EXISTS release_reminder_level smallint NOT NULL DEFAULT 0;
ALTER TABLE dependent_profiles ADD COLUMN IF NOT EXISTS frozen_reason varchar(24);

ALTER TABLE dependent_profiles DROP CONSTRAINT IF EXISTS dependent_profiles_release_pair_ck;
ALTER TABLE dependent_profiles ADD CONSTRAINT dependent_profiles_release_pair_ck
  CHECK ((released_at IS NULL) = (release_deadline_at IS NULL));

ALTER TABLE dependent_profiles DROP CONSTRAINT IF EXISTS dependent_profiles_release_completed_ck;
ALTER TABLE dependent_profiles ADD CONSTRAINT dependent_profiles_release_completed_ck
  CHECK (release_completed_at IS NULL OR release_accepted_at IS NOT NULL);

ALTER TABLE dependent_profiles DROP CONSTRAINT IF EXISTS dependent_profiles_release_source_ck;
ALTER TABLE dependent_profiles ADD CONSTRAINT dependent_profiles_release_source_ck
  CHECK (release_source IS NULL OR release_source IN ('cron', 'catchup'));

-- Reminders at deadline-7d (level 1) and deadline-1d (level 2), ruling R2.
ALTER TABLE dependent_profiles DROP CONSTRAINT IF EXISTS dependent_profiles_release_reminder_ck;
ALTER TABLE dependent_profiles ADD CONSTRAINT dependent_profiles_release_reminder_ck
  CHECK (release_reminder_level BETWEEN 0 AND 2);

ALTER TABLE dependent_profiles DROP CONSTRAINT IF EXISTS dependent_profiles_frozen_reason_ck;
ALTER TABLE dependent_profiles ADD CONSTRAINT dependent_profiles_frozen_reason_ck
  CHECK (frozen_reason IS NULL OR (frozen_at IS NOT NULL AND frozen_reason IN ('majority_release')));

-- Phase 2 required purge_after whenever frozen_at is set. A majority-release
-- freeze never has a purge date (R6), so the pair rule now depends on the reason:
--   * not frozen: neither frozen_at nor purge_after;
--   * legacy freeze (reason NULL): frozen_at AND purge_after;
--   * majority-release freeze: frozen_at and NO purge_after.
ALTER TABLE dependent_profiles DROP CONSTRAINT IF EXISTS dependent_profiles_frozen_ck;
ALTER TABLE dependent_profiles ADD CONSTRAINT dependent_profiles_frozen_ck
  CHECK (
    (frozen_at IS NULL AND purge_after IS NULL)
    OR (frozen_at IS NOT NULL AND frozen_reason IS NULL AND purge_after IS NOT NULL)
    -- frozen_reason IS NOT NULL is required: with a NULL reason the comparison is
    -- UNKNOWN, and a CHECK treats UNKNOWN as PASS (legacy freeze w/o purge_after).
    OR (frozen_at IS NOT NULL AND frozen_reason IS NOT NULL AND frozen_reason = 'majority_release' AND purge_after IS NULL)
  );

-- Notice / release scan.
CREATE INDEX IF NOT EXISTS idx_dependent_profiles_unreleased
  ON dependent_profiles (user_id)
  WHERE released_at IS NULL AND frozen_at IS NULL AND purged_at IS NULL;

-- Reminders / freeze scan.
CREATE INDEX IF NOT EXISTS idx_dependent_profiles_release_deadline
  ON dependent_profiles (release_deadline_at)
  WHERE released_at IS NOT NULL AND release_completed_at IS NULL AND frozen_at IS NULL AND purged_at IS NULL;

-- Rollback (unused with the flag off; restore the Phase 2 pair rule first):
--   ALTER TABLE dependent_profiles DROP CONSTRAINT IF EXISTS dependent_profiles_frozen_ck;
--   ALTER TABLE dependent_profiles ADD CONSTRAINT dependent_profiles_frozen_ck CHECK ((frozen_at IS NULL) = (purge_after IS NULL));
--   DROP INDEX IF EXISTS idx_dependent_profiles_release_deadline;
--   DROP INDEX IF EXISTS idx_dependent_profiles_unreleased;
--   ALTER TABLE dependent_profiles DROP CONSTRAINT IF EXISTS dependent_profiles_frozen_reason_ck, DROP CONSTRAINT IF EXISTS dependent_profiles_release_reminder_ck, DROP CONSTRAINT IF EXISTS dependent_profiles_release_source_ck, DROP CONSTRAINT IF EXISTS dependent_profiles_release_completed_ck, DROP CONSTRAINT IF EXISTS dependent_profiles_release_pair_ck;
--   ALTER TABLE dependent_profiles DROP COLUMN IF EXISTS frozen_reason, DROP COLUMN IF EXISTS release_reminder_level, DROP COLUMN IF EXISTS release_completed_at, DROP COLUMN IF EXISTS release_accepted_at, DROP COLUMN IF EXISTS release_source, DROP COLUMN IF EXISTS release_deadline_at, DROP COLUMN IF EXISTS released_at, DROP COLUMN IF EXISTS majority_notice_sent_at;
