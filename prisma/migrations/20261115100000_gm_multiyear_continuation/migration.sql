-- Multi-year Master Guide continuation (ruling 2026-11-13, architecture/gm-multiyear-continuation).
-- Strictly additive / relaxing; no data is rewritten. Render runs `prisma migrate deploy`
-- at the END OF THE BUILD. Re-runnable.
--
-- 1) enrollments.duration_start_year_id: when an open multi-year enrollment is carried
--    into a new ecclesiastical year (same row, same progress), ecclesiastical_year_id moves
--    forward; this column remembers the year the class started counting, so the
--    min/max duration math (inclusive count of ecclesiastical years) keeps working.
--    NULL = ecclesiastical_year_id (every row that exists today).
ALTER TABLE enrollments
  ADD COLUMN IF NOT EXISTS duration_start_year_id integer;

ALTER TABLE enrollments
  DROP CONSTRAINT IF EXISTS enrollments_duration_start_year_id_fkey;
ALTER TABLE enrollments
  ADD CONSTRAINT enrollments_duration_start_year_id_fkey
  FOREIGN KEY (duration_start_year_id) REFERENCES ecclesiastical_years (year_id)
  ON DELETE NO ACTION ON UPDATE NO ACTION;

-- 2) A user may re-open GM-01 after the previous row became EXPIRED (past
--    max_duration_years without investiture; old progress stays as history on the
--    EXPIRED row). Any non-EXPIRED sibling row still raises ENROLLMENT_GM_SINGLE_ROW.
CREATE OR REPLACE FUNCTION enforce_single_guide_major_enrollment()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  gm_class_id integer;
  other_count integer;
BEGIN
  SELECT class_id INTO gm_class_id
  FROM classes
  WHERE asset_code = 'GM-01'
  LIMIT 1;

  IF gm_class_id IS NULL OR NEW.class_id IS DISTINCT FROM gm_class_id THEN
    RETURN NEW;
  END IF;

  SELECT COUNT(*) INTO other_count
  FROM enrollments
  WHERE user_id = NEW.user_id
    AND class_id = gm_class_id
    AND investiture_status <> 'EXPIRED'
    AND enrollment_id IS DISTINCT FROM NEW.enrollment_id;

  IF other_count > 0 THEN
    RAISE EXCEPTION 'ENROLLMENT_GM_SINGLE_ROW'
      USING ERRCODE = '23505';
  END IF;

  RETURN NEW;
END;
$$;
