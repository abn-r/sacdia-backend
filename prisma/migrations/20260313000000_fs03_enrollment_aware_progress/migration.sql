-- FS-03 Enrollment-aware progress
-- Scope: move class progress ownership to enrollments.enrollment_id
-- Policy: bounded backfill only when user_id + class_id maps to exactly one enrollment

ALTER TABLE class_module_progress
  ADD COLUMN IF NOT EXISTS enrollment_id INTEGER;

ALTER TABLE class_section_progress
  ADD COLUMN IF NOT EXISTS enrollment_id INTEGER;

ALTER TABLE class_module_progress
  DROP CONSTRAINT IF EXISTS class_module_progress_user_id_class_id_module_id_key;

ALTER TABLE class_section_progress
  DROP CONSTRAINT IF EXISTS class_section_progress_user_id_class_id_module_id_section_id_key;

ALTER TABLE class_module_progress
  ADD CONSTRAINT class_module_progress_enrollment_id_fkey
  FOREIGN KEY (enrollment_id)
  REFERENCES enrollments(enrollment_id)
  ON DELETE NO ACTION
  ON UPDATE NO ACTION;

ALTER TABLE class_section_progress
  ADD CONSTRAINT class_section_progress_enrollment_id_fkey
  FOREIGN KEY (enrollment_id)
  REFERENCES enrollments(enrollment_id)
  ON DELETE NO ACTION
  ON UPDATE NO ACTION;

WITH deterministic_module_candidates AS (
  SELECT
    cmp.module_progress_id,
    MIN(e.enrollment_id) AS enrollment_id
  FROM class_module_progress cmp
  JOIN enrollments e
    ON e.user_id = cmp.user_id
   AND e.class_id = cmp.class_id
  WHERE cmp.enrollment_id IS NULL
  GROUP BY cmp.module_progress_id
  HAVING COUNT(*) = 1
)
UPDATE class_module_progress cmp
SET enrollment_id = deterministic_module_candidates.enrollment_id
FROM deterministic_module_candidates
WHERE cmp.module_progress_id = deterministic_module_candidates.module_progress_id;

WITH deterministic_section_candidates AS (
  SELECT
    csp.section_progress_id,
    MIN(e.enrollment_id) AS enrollment_id
  FROM class_section_progress csp
  JOIN enrollments e
    ON e.user_id = csp.user_id
   AND e.class_id = csp.class_id
  WHERE csp.enrollment_id IS NULL
  GROUP BY csp.section_progress_id
  HAVING COUNT(*) = 1
)
UPDATE class_section_progress csp
SET enrollment_id = deterministic_section_candidates.enrollment_id
FROM deterministic_section_candidates
WHERE csp.section_progress_id = deterministic_section_candidates.section_progress_id;

CREATE UNIQUE INDEX IF NOT EXISTS class_module_progress_enrollment_module_uidx
  ON class_module_progress (enrollment_id, module_id)
  WHERE enrollment_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS class_section_progress_enrollment_module_section_uidx
  ON class_section_progress (enrollment_id, module_id, section_id)
  WHERE enrollment_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS class_module_progress_enrollment_idx
  ON class_module_progress (enrollment_id)
  WHERE enrollment_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS class_section_progress_enrollment_idx
  ON class_section_progress (enrollment_id)
  WHERE enrollment_id IS NOT NULL;
