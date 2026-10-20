-- Migration: 20261022120000_family_director_minors
-- Phase 3c: birthday-13 nudge marker. Additive and nullable: NULL means "never nudged".
-- No creator column is added: dependent_profiles.created_by_user_id already exists (Phase 2) and the
-- consent four-eyes rule reads it. No DML, no default, no constraint changes.
-- Render runs `prisma migrate deploy` at the END OF THE BUILD (no preDeploy); one transaction; re-runnable.
-- Rollback (manual, per Neon branch): the column can stay unused, or be dropped by hand.
ALTER TABLE dependent_profiles ADD COLUMN IF NOT EXISTS teen_login_nudged_at timestamptz(6);
