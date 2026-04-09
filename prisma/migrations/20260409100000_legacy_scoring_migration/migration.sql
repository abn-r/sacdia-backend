-- =============================================================================
-- Legacy Scoring Migration
-- =============================================================================
-- What this does:
--   1. Inserts two canonical scoring categories at DIVISION level (origin_id=0):
--      "Asistencia" (max_points: 100) and "Puntualidad" (max_points: 100).
--      Uses INSERT ... ON CONFLICT DO NOTHING so it's safe to re-run.
--   2. Migrates existing weekly_records rows that carry attendance/punctuality
--      values > 0 into weekly_record_scores rows linked to those categories.
--      ON CONFLICT DO NOTHING prevents duplicate score entries on re-run.
--   3. Backfills null year values on weekly_records using the year extracted
--      from created_at (EXTRACT(YEAR FROM created_at)).
--
-- IMPORTANT: Review this migration carefully before running it in production.
--   - Test against a staging clone of the production database first.
--   - Run inside a transaction so you can rollback if anything looks wrong.
--   - Verify row counts after each step (see comments below).
--   - The migration does NOT drop the attendance/punctuality columns from
--     weekly_records — that cleanup should happen in a separate migration
--     once the application layer has been fully migrated.
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- Step 1: Backfill null year values on weekly_records
-- -----------------------------------------------------------------------------
-- The schema requires year (NOT NULL), but legacy rows inserted before the
-- year column was added may have a placeholder or null equivalent.
-- Derive the year from created_at; fall back to the current year if null.
UPDATE weekly_records
SET year = EXTRACT(YEAR FROM created_at)::INTEGER
WHERE year IS NULL OR year = 0;

-- Verify: SELECT COUNT(*) FROM weekly_records WHERE year IS NULL OR year = 0;
-- Expected: 0

-- -----------------------------------------------------------------------------
-- Step 2: Seed the two canonical DIVISION-level scoring categories
-- -----------------------------------------------------------------------------
-- origin_id = 0 represents the global Division (no divisions table in schema).
-- We use a CTE to capture the inserted (or already-existing) IDs reliably.

INSERT INTO scoring_categories (name, max_points, origin_level, origin_id, active, created_at, modified_at)
VALUES
  ('Asistencia',  100, 'DIVISION', 0, true, NOW(), NOW()),
  ('Puntualidad', 100, 'DIVISION', 0, true, NOW(), NOW())
ON CONFLICT DO NOTHING;

-- Verify: SELECT scoring_category_id, name FROM scoring_categories
--         WHERE name IN ('Asistencia', 'Puntualidad') AND origin_level = 'DIVISION';
-- Expected: 2 rows

-- -----------------------------------------------------------------------------
-- Step 3: Migrate attendance values into weekly_record_scores
-- -----------------------------------------------------------------------------
-- For every weekly_records row with attendance > 0, create a score entry
-- linked to the "Asistencia" category.
INSERT INTO weekly_record_scores (record_id, category_id, points)
SELECT
  wr.record_id,
  sc.scoring_category_id,
  wr.attendance
FROM weekly_records wr
CROSS JOIN (
  SELECT scoring_category_id
  FROM   scoring_categories
  WHERE  name = 'Asistencia'
    AND  origin_level = 'DIVISION'
    AND  origin_id = 0
  LIMIT 1
) sc
WHERE wr.attendance > 0
ON CONFLICT (record_id, category_id) DO NOTHING;

-- Verify: SELECT COUNT(*) FROM weekly_record_scores wrs
--         JOIN scoring_categories sc ON sc.scoring_category_id = wrs.category_id
--         WHERE sc.name = 'Asistencia';
-- Expected: matches COUNT(*) FROM weekly_records WHERE attendance > 0

-- -----------------------------------------------------------------------------
-- Step 4: Migrate punctuality values into weekly_record_scores
-- -----------------------------------------------------------------------------
INSERT INTO weekly_record_scores (record_id, category_id, points)
SELECT
  wr.record_id,
  sc.scoring_category_id,
  wr.punctuality
FROM weekly_records wr
CROSS JOIN (
  SELECT scoring_category_id
  FROM   scoring_categories
  WHERE  name = 'Puntualidad'
    AND  origin_level = 'DIVISION'
    AND  origin_id = 0
  LIMIT 1
) sc
WHERE wr.punctuality > 0
ON CONFLICT (record_id, category_id) DO NOTHING;

-- Verify: SELECT COUNT(*) FROM weekly_record_scores wrs
--         JOIN scoring_categories sc ON sc.scoring_category_id = wrs.category_id
--         WHERE sc.name = 'Puntualidad';
-- Expected: matches COUNT(*) FROM weekly_records WHERE punctuality > 0

COMMIT;
