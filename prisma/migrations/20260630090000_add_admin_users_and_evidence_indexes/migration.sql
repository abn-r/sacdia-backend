-- Migration: 20260630090000_add_admin_users_and_evidence_indexes
-- Adds indexes to support admin user listing and evidence-review hot paths under load.
--
-- This migration is intended for manual rollout with Prisma tracking registration.
-- It uses CREATE INDEX CONCURRENTLY (NOT IN a transaction), consistent with
-- the existing manual migration style in this runtime.
--
-- CREATE EXTENSION notes
--   - Postgres CREATE EXTENSION is idempotent with IF NOT EXISTS.
--   - It does not support CONCURRENTLY; this is fine because extension installs
--     are DDL-only and cheap, but still intentionally separated from concurrent
--     index registration statements.

-- Required for trigram indexes below.
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- ============================================================
-- users: admin listing hot paths
-- ============================================================
-- ORDER-BY + filter patterns in /admin/users use created_at and optional
-- active / union / local_field filters. These covering indexes reduce sort+scan.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_users_created_at_desc
  ON users (created_at DESC);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_users_active_created_at_desc
  ON users (active, created_at DESC);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_users_union_active_created_at_desc
  ON users (union_id, active, created_at DESC);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_users_local_field_active_created_at_desc
  ON users (local_field_id, active, created_at DESC);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_users_approval_status_created_at_desc
  ON users (approval_status, created_at DESC);

-- ============================================================
-- users: text search acceleration
-- ============================================================
-- Evidence for /admin users includes case-insensitive contains search on these
-- columns (ILIKE/contains), which is a common candidate for trigram GIN.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_users_email_trgm
  ON users USING gin (email gin_trgm_ops);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_users_name_trgm
  ON users USING gin (name gin_trgm_ops);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_users_paternal_last_name_trgm
  ON users USING gin (paternal_last_name gin_trgm_ops);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_users_maternal_last_name_trgm
  ON users USING gin (maternal_last_name gin_trgm_ops);

-- ============================================================
-- evidence-review and validation workflows
-- ============================================================
-- Queries filter status + active and sort by submit timestamp in both
-- class_section_progress and users_honors review paths.
-- Using partial indexes on active=true keeps index size smaller and speeds scans.

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_class_section_progress_status_active_submitted_at_desc
  ON class_section_progress (status, submitted_at DESC)
  WHERE active = true;

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_users_honors_validation_status_active_submitted_at_desc
  ON users_honors (validation_status, submitted_at DESC)
  WHERE active = true;

-- Current access pattern for permissioned role resolution frequently scans by
-- club_section_id and membership status + user lookup.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_club_role_assignments_club_section_active_status_user
  ON club_role_assignments (club_section_id, status, user_id)
  WHERE active = true;

-- Additional file lookup indexes requested for evidence retrieval flows.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_evidence_files_section_progress_active_uploaded_at_desc
  ON evidence_files (section_progress_id, uploaded_at DESC)
  WHERE active = true;

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_evidence_files_user_honor_active_uploaded_at_desc
  ON evidence_files (user_honor_id, uploaded_at DESC)
  WHERE active = true;

-- Register manual migration so this change is tracked by Prisma.
-- _prisma_migrations has no unique constraint on migration_name (PK is id),
-- so use INSERT ... WHERE NOT EXISTS to avoid duplicates on re-runs.
INSERT INTO "_prisma_migrations" (
  id,
  checksum,
  finished_at,
  migration_name,
  logs,
  rolled_back_at,
  started_at,
  applied_steps_count
)
SELECT
  gen_random_uuid(),
  'manual',
  now(),
  '20260630090000_add_admin_users_and_evidence_indexes',
  NULL,
  NULL,
  now(),
  1
WHERE NOT EXISTS (
  SELECT 1
  FROM "_prisma_migrations"
  WHERE migration_name = '20260630090000_add_admin_users_and_evidence_indexes'
);
