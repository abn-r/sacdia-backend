-- Enforce at most one active enrollment per (user, ecclesiastical_year).
-- Resolves the recurring `formative_read_model_conflict` warning emitted by
-- AdminUsersService when more than one row in `enrollments` is active for the
-- same user and year. The admin user-detail read model assumes a single
-- operational enrollment per (user, year) — multiple actives mean dirty data.
--
-- Strategy:
--   1. Dedup existing rows. Ranking priority:
--        a. INVESTIDO wins over any other status (preserves investiture history).
--        b. Otherwise most recent (enrollment_date DESC, enrollment_id DESC).
--      Lower-ranked rows are flipped to active=false.
--   2. Create a PARTIAL UNIQUE INDEX guaranteeing the invariant going forward.
--
-- Note: Prisma does not model partial unique indexes; the schema keeps the
-- existing `@@unique([user_id, class_id, ecclesiastical_year_id])` constraint
-- so multiple INACTIVE enrollments per (user, class, year) remain valid.
-- This partial index is database-level only.

BEGIN;

-- 1. Cleanup current duplicates.
WITH ranked AS (
  SELECT
    enrollment_id,
    ROW_NUMBER() OVER (
      PARTITION BY user_id, ecclesiastical_year_id
      ORDER BY
        (investiture_status = 'INVESTIDO') DESC,
        enrollment_date DESC,
        enrollment_id DESC
    ) AS rn
  FROM enrollments
  WHERE active = true
)
UPDATE enrollments
SET active = false,
    modified_at = NOW()
WHERE enrollment_id IN (
  SELECT enrollment_id FROM ranked WHERE rn > 1
);

-- 2. Prevent future duplicates.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_enrollments_active_user_year
  ON enrollments (user_id, ecclesiastical_year_id)
  WHERE active = true;

COMMIT;
