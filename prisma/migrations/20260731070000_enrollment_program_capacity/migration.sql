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
AS $$
DECLARE
  program formative_program_type_enum;
  capacity INTEGER;
  active_count BIGINT;
BEGIN
  IF NEW.active IS DISTINCT FROM TRUE THEN
    RETURN NEW;
  END IF;

  SELECT formative_program_type
  INTO program
  FROM classes
  WHERE class_id = NEW.class_id;

  IF NOT FOUND THEN
    RETURN NEW;
  END IF;

  capacity := CASE WHEN program = 'GUIDE_MAJOR' THEN 2 ELSE 1 END;
  PERFORM pg_advisory_xact_lock(hashtextextended(
    'enrollment_capacity:' || NEW.user_id::text || ':' ||
    NEW.ecclesiastical_year_id::text || ':' || program::text,
    0
  ));

  SELECT COUNT(*)
  INTO active_count
  FROM enrollments enrollment
  JOIN classes class ON class.class_id = enrollment.class_id
  WHERE enrollment.user_id = NEW.user_id
    AND enrollment.ecclesiastical_year_id = NEW.ecclesiastical_year_id
    AND enrollment.active IS TRUE
    AND class.formative_program_type = program
    AND enrollment.enrollment_id IS DISTINCT FROM NEW.enrollment_id;

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
