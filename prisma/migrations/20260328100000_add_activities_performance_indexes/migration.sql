-- Migration: add_activities_performance_indexes
--
-- Adds composite indexes to improve activities query performance:
-- 1. activities(active, activity_type_id) — covers findByClub WHERE filter
-- 2. activity_instances(club_section_id, active) — covers the `some` join condition

CREATE INDEX IF NOT EXISTS "idx_activities_active_type"
    ON "activities"("active", "activity_type_id");

CREATE INDEX IF NOT EXISTS "idx_activity_instances_section_active"
    ON "activity_instances"("club_section_id", "active");
