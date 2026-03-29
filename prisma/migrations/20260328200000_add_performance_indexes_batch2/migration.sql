-- Migration: add_performance_indexes_batch2
--
-- Adds missing indexes to tables that grow continuously with user activity.
-- All indexes use IF NOT EXISTS for safe re-execution.
--
-- Priority breakdown:
--   HIGH   — camporee_members: grows with every event registration
--   MEDIUM — folders_section_records: queried by status in evidence review workflows
--   MEDIUM — class_section_progress: queried by enrollment_id in class progress lookups
--   LOW    — folders_modules_records: queried by folder_id in scoring aggregations

-- ─── camporee_members ────────────────────────────────────────────────────────
-- Covers queries filtering by local camporee (polymorphic FK pattern)
CREATE INDEX IF NOT EXISTS "idx_camporee_members_camporee_id"
    ON "camporee_members"("camporee_id");

-- Covers queries filtering by user across all camporees
CREATE INDEX IF NOT EXISTS "idx_camporee_members_user_id"
    ON "camporee_members"("user_id");

-- Composite: active members for a given camporee (admin dashboard filter)
CREATE INDEX IF NOT EXISTS "idx_camporee_members_camporee_active"
    ON "camporee_members"("camporee_id", "active");

-- Covers approval workflow queries by status (registered / approved / rejected)
CREATE INDEX IF NOT EXISTS "idx_camporee_members_status"
    ON "camporee_members"("status");

-- ─── folders_section_records ─────────────────────────────────────────────────
-- Covers evidence review queue filtered by status (PENDING / VALIDATED / REJECTED)
CREATE INDEX IF NOT EXISTS "idx_folders_section_records_status"
    ON "folders_section_records"("status");

-- Composite: active records for a folder (scoring aggregation queries)
CREATE INDEX IF NOT EXISTS "idx_folders_section_records_folder_active"
    ON "folders_section_records"("folder_id", "active");

-- ─── folders_modules_records ─────────────────────────────────────────────────
-- Covers module score aggregations grouped by folder_id
CREATE INDEX IF NOT EXISTS "idx_folders_modules_records_folder_id"
    ON "folders_modules_records"("folder_id");

-- ─── class_section_progress ──────────────────────────────────────────────────
-- enrollment_id is not covered by the existing unique(user_id, class_id,
-- module_id, section_id) constraint — needs a separate index for enrollment
-- lookups in class progress queries
CREATE INDEX IF NOT EXISTS "idx_class_section_progress_enrollment_id"
    ON "class_section_progress"("enrollment_id");
