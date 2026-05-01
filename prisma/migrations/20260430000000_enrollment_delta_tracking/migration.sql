-- Plan 8.4-A Task 27 — Delta-only recalc optimization
-- Adds last_progress_change column to enrollments + 3 trigger functions/triggers
-- on source tables (class_module_progress, camporee_members, investiture_validation_history)
-- to bump the timestamp when relevant member progress changes.
--
-- Why: nightly cron currently recalculates ALL active enrollments. With delta mode
-- (opt-in via mode='delta'), only enrollments with progress changes since the last
-- recalc are processed, reducing load 70-90% in steady-state.
--
-- This is the FIRST migration introducing PostgreSQL triggers in this repo.
-- Convention established here:
--   - Functions: snake_case, descriptive verb (e.g. update_enrollment_last_progress)
--   - Triggers: trg_<source_table>_<action> (e.g. trg_class_module_progress_score_change)
--   - Timing: AFTER (allows record to exist before touch)
--   - Functions use SECURITY DEFINER and SET search_path = public to be safe under
--     varied caller search_paths

-- 1. Column + index on enrollments
ALTER TABLE enrollments
  ADD COLUMN last_progress_change TIMESTAMPTZ(6) NOT NULL DEFAULT NOW();

-- Backfill defensive: existing rows get created_at as initial last_progress_change.
-- DEFAULT NOW() already populates fresh INSERTs; this UPDATE aligns pre-existing rows
-- to their creation time instead of the migration run timestamp, preserving semantics:
-- "last known progress change = at least as old as when the enrollment was created".
UPDATE enrollments
  SET last_progress_change = created_at
  WHERE last_progress_change > created_at;

CREATE INDEX idx_enrollments_last_progress
  ON enrollments(last_progress_change);

-- 2. Trigger function: bump enrollment.last_progress_change by enrollment_id
--    Used by class_module_progress (optional FK enrollment_id) and
--    investiture_validation_history (direct FK enrollment_id).
--    Note: class_module_progress.enrollment_id is nullable (Int?); the trigger
--    guards against NULL with a WHEN clause defined on each trigger below.
CREATE OR REPLACE FUNCTION update_enrollment_last_progress_by_id()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE enrollments
    SET last_progress_change = NOW()
    WHERE enrollment_id = NEW.enrollment_id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql
   SECURITY DEFINER
   SET search_path = public;

-- 3. Trigger function: bump enrollment.last_progress_change by user_id (camporee_members)
--    NOTE: camporee_members has no enrollment_id FK. We update ALL active enrollments
--    for the user (typically 1-2 — the over-broad bump is cheap and ensures correctness).
--    Trade-off: a user with stale enrollments in older years will have those bumped too,
--    but the delta filter still skips them based on yearId, so this is safe.
CREATE OR REPLACE FUNCTION update_enrollment_last_progress_by_user()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE enrollments
    SET last_progress_change = NOW()
    WHERE user_id = NEW.user_id
      AND active = true;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql
   SECURITY DEFINER
   SET search_path = public;

-- 4. Triggers

-- 4a. class_module_progress: column-specific UPDATE OF score (avoids spurious touches).
--     enrollment_id is nullable (Int?) — WHEN clause skips rows without an enrollment FK.
DROP TRIGGER IF EXISTS trg_class_module_progress_score_change ON class_module_progress;
CREATE TRIGGER trg_class_module_progress_score_change
  AFTER INSERT OR UPDATE OF score ON class_module_progress
  FOR EACH ROW
  WHEN (NEW.enrollment_id IS NOT NULL)
  EXECUTE FUNCTION update_enrollment_last_progress_by_id();

-- 4b. investiture_validation_history: INSERT only (audit log — rows are never updated).
DROP TRIGGER IF EXISTS trg_investiture_validation_history_insert ON investiture_validation_history;
CREATE TRIGGER trg_investiture_validation_history_insert
  AFTER INSERT ON investiture_validation_history
  FOR EACH ROW EXECUTE FUNCTION update_enrollment_last_progress_by_id();

-- 4c. camporee_members: INSERT or UPDATE (status change matters for score).
DROP TRIGGER IF EXISTS trg_camporee_members_change ON camporee_members;
CREATE TRIGGER trg_camporee_members_change
  AFTER INSERT OR UPDATE ON camporee_members
  FOR EACH ROW EXECUTE FUNCTION update_enrollment_last_progress_by_user();
