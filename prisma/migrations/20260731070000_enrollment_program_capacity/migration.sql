BEGIN;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM enrollments enrollment
    JOIN classes class ON class.class_id = enrollment.class_id
    WHERE enrollment.active IS TRUE
    GROUP BY enrollment.user_id, enrollment.ecclesiastical_year_id,
      class.formative_program_type
    HAVING COUNT(*) > CASE
      WHEN class.formative_program_type = 'GUIDE_MAJOR' THEN 2 ELSE 1
    END
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      CONSTRAINT = 'enrollments_active_program_capacity_preflight',
      MESSAGE = 'active enrollment data exceeds canonical program capacity';
  END IF;
END;
$$;

DROP INDEX IF EXISTS uniq_enrollments_active_user_year;

CREATE OR REPLACE FUNCTION enforce_active_enrollment_capacity()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  program TEXT;
  capacity INTEGER;
  active_count BIGINT;
BEGIN
  IF NEW.active IS DISTINCT FROM TRUE THEN
    RETURN NEW;
  END IF;

  EXECUTE pg_catalog.format(
    'SELECT formative_program_type::text FROM %I.classes WHERE class_id = $1',
    TG_TABLE_SCHEMA
  ) INTO program USING NEW.class_id;

  IF program IS NULL THEN
    RETURN NEW;
  END IF;

  capacity := CASE WHEN program = 'GUIDE_MAJOR' THEN 2 ELSE 1 END;
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'enrollment_capacity:' || NEW.user_id::text || ':' ||
    NEW.ecclesiastical_year_id::text || ':' || program::text,
    0
  ));

  EXECUTE pg_catalog.format(
    'SELECT pg_catalog.count(*)
     FROM %1$I.enrollments enrollment
     JOIN %1$I.classes class ON class.class_id = enrollment.class_id
     WHERE enrollment.user_id = $1
       AND enrollment.ecclesiastical_year_id = $2
       AND enrollment.active IS TRUE
       AND class.formative_program_type::text = $3
       AND enrollment.enrollment_id IS DISTINCT FROM $4',
    TG_TABLE_SCHEMA
  ) INTO active_count
    USING NEW.user_id, NEW.ecclesiastical_year_id, program, NEW.enrollment_id;

  IF active_count >= capacity THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      CONSTRAINT = 'enrollments_active_program_capacity_check',
      MESSAGE = 'active enrollment capacity reached for formative program';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_active_enrollment_capacity ON enrollments;
CREATE TRIGGER trg_enforce_active_enrollment_capacity
BEFORE INSERT OR UPDATE OF user_id, class_id, ecclesiastical_year_id, active
ON enrollments
FOR EACH ROW
EXECUTE FUNCTION enforce_active_enrollment_capacity();

CREATE OR REPLACE FUNCTION prevent_formative_program_reclassification()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  IF NEW.formative_program_type IS DISTINCT FROM OLD.formative_program_type THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      CONSTRAINT = 'classes_formative_program_type_immutable_check',
      MESSAGE = 'formative program ownership is immutable';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_prevent_formative_program_reclassification ON classes;
CREATE TRIGGER trg_prevent_formative_program_reclassification
BEFORE UPDATE OF formative_program_type ON classes
FOR EACH ROW
EXECUTE FUNCTION prevent_formative_program_reclassification();

COMMIT;
