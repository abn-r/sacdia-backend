-- Phase 4 (release at majority): data PREP only. Guarantees the tracking
-- invariant "every guardianships.dependent_user_id and every
-- supervised_logins.user_id has a dependent_profiles row".
-- NO release-column DML here: the "already 18+ => released on day one" backfill
-- is the cron catch-up path (single source of age math: Feb-29, per-country
-- policy, time zone). PG interval math would clamp Feb-29 to Feb-28 while
-- ageAt() reaches majority on Mar-1.
-- Re-runnable (ON CONFLICT DO NOTHING).

INSERT INTO dependent_profiles (user_id, created_by_user_id, created_at)
SELECT DISTINCT d.uid, d.uid, now()
FROM (
  SELECT dependent_user_id AS uid FROM guardianships
  UNION
  SELECT user_id AS uid FROM supervised_logins
) d
WHERE NOT EXISTS (SELECT 1 FROM dependent_profiles p WHERE p.user_id = d.uid)
ON CONFLICT (user_id) DO NOTHING;

-- Verification (expect 0 rows):
--   SELECT d.uid FROM (
--     SELECT dependent_user_id AS uid FROM guardianships
--     UNION SELECT user_id FROM supervised_logins
--   ) d WHERE NOT EXISTS (SELECT 1 FROM dependent_profiles p WHERE p.user_id = d.uid);
