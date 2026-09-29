-- Separate historical certificate facts from the operational enrollment slot.
-- Existing rows stay OPERATIONAL. This migration does not classify imported
-- rows and does not delete Guía Mayor enrollments.
--
-- Dry-run only (do not execute as part of this migration):
-- SELECT i.item_id, i.applied_entity_id, e.enrollment_id,
--        e.investiture_status, e.ecclesiastical_year_id
-- FROM certificate_bulk_import_items i
-- JOIN enrollments e ON e.enrollment_id = i.applied_entity_id
-- WHERE i.applied_entity_type = 'ENROLLMENT';

DO $$
BEGIN
  CREATE TYPE enrollment_record_kind AS ENUM (
    'OPERATIONAL',
    'HISTORICAL_CERTIFICATE'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE enrollments
  ADD COLUMN IF NOT EXISTS record_kind enrollment_record_kind
  NOT NULL DEFAULT 'OPERATIONAL';

DROP INDEX IF EXISTS uniq_enrollments_active_user_year;
DROP INDEX IF EXISTS uniq_enrollments_active_user_year_regular;
DROP INDEX IF EXISTS uniq_enrollments_active_user_year_cross_type;

CREATE UNIQUE INDEX uniq_enrollments_active_user_year_regular
  ON enrollments (user_id, ecclesiastical_year_id)
  WHERE active = true
    AND cross_type_enrollment = false
    AND record_kind = 'OPERATIONAL';

CREATE UNIQUE INDEX uniq_enrollments_active_user_year_cross_type
  ON enrollments (user_id, ecclesiastical_year_id)
  WHERE active = true
    AND cross_type_enrollment = true
    AND record_kind = 'OPERATIONAL';

ALTER TABLE enrollments
  DROP CONSTRAINT IF EXISTS enrollments_historical_certificate_shape;

ALTER TABLE enrollments
  ADD CONSTRAINT enrollments_historical_certificate_shape
  CHECK (
    record_kind <> 'HISTORICAL_CERTIFICATE'
    OR (
      investiture_status = 'INVESTIDO'
      AND investiture_date IS NOT NULL
      AND active = true
      AND locked_for_validation = true
    )
  );

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
    AND enrollment_id IS DISTINCT FROM NEW.enrollment_id;

  IF other_count > 0 THEN
    RAISE EXCEPTION 'ENROLLMENT_GM_SINGLE_ROW'
      USING ERRCODE = '23505';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enrollments_single_guide_major ON enrollments;

CREATE TRIGGER trg_enrollments_single_guide_major
  BEFORE INSERT OR UPDATE OF class_id, user_id
  ON enrollments
  FOR EACH ROW
  EXECUTE FUNCTION enforce_single_guide_major_enrollment();
