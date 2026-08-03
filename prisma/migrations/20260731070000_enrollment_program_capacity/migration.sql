BEGIN;

LOCK TABLE classes IN SHARE MODE;
LOCK TABLE enrollments IN ACCESS EXCLUSIVE MODE;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM enrollments enrollment
    JOIN classes class ON class.class_id = enrollment.class_id
    WHERE enrollment.active IS TRUE
    GROUP BY enrollment.user_id, enrollment.ecclesiastical_year_id,
      class.formative_program_type
    HAVING COUNT(*) > CASE
      WHEN class.formative_program_type = 'GUIDE_MAJOR' THEN 2 ELSE 1 END
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      CONSTRAINT = 'enrollments_active_program_capacity_preflight',
      MESSAGE = 'active enrollment data exceeds canonical program capacity';
  END IF;
END;
$$;

CREATE TABLE IF NOT EXISTS enrollment_program_capacity_claims (
  enrollment_id INTEGER PRIMARY KEY REFERENCES enrollments(enrollment_id)
    ON DELETE CASCADE,
  user_id UUID NOT NULL,
  ecclesiastical_year_id INTEGER NOT NULL,
  formative_program_type formative_program_type_enum NOT NULL,
  capacity_slot INTEGER NOT NULL,
  CONSTRAINT enrollment_program_capacity_claims_slot_check CHECK (
    (formative_program_type = 'STANDARD' AND capacity_slot = 1) OR
    (formative_program_type = 'GUIDE_MAJOR' AND capacity_slot BETWEEN 1 AND 2)
  ),
  CONSTRAINT enrollment_program_capacity_claims_slot_key UNIQUE (
    user_id, ecclesiastical_year_id, formative_program_type, capacity_slot
  )
);

CREATE OR REPLACE FUNCTION sync_active_enrollment_capacity_claim()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  program TEXT;
  capacity INTEGER;
  slot INTEGER;
  violated_constraint TEXT;
BEGIN
  EXECUTE pg_catalog.format(
    'DELETE FROM %I.enrollment_program_capacity_claims WHERE enrollment_id = $1',
    TG_TABLE_SCHEMA
  ) USING NEW.enrollment_id;

  IF NEW.active IS DISTINCT FROM TRUE THEN
    RETURN NEW;
  END IF;

  EXECUTE pg_catalog.format(
    'SELECT formative_program_type::text FROM %I.classes WHERE class_id = $1',
    TG_TABLE_SCHEMA
  ) INTO program USING NEW.class_id;

  IF program NOT IN ('STANDARD', 'GUIDE_MAJOR') THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      CONSTRAINT = 'enrollments_active_program_capacity_check',
      DETAIL = 'SACDIA_ENROLLMENT_PROGRAM_CAPACITY',
      MESSAGE = 'active enrollment has no canonical formative program';
  END IF;

  capacity := CASE WHEN program = 'GUIDE_MAJOR' THEN 2 ELSE 1 END;
  FOR slot IN 1..capacity LOOP
    BEGIN
      EXECUTE pg_catalog.format(
        'INSERT INTO %I.enrollment_program_capacity_claims
          (enrollment_id, user_id, ecclesiastical_year_id, formative_program_type, capacity_slot)
         VALUES ($1, $2, $3, $4::%I.formative_program_type_enum, $5)',
        TG_TABLE_SCHEMA, TG_TABLE_SCHEMA
      ) USING NEW.enrollment_id, NEW.user_id, NEW.ecclesiastical_year_id, program, slot;
      RETURN NEW;
    EXCEPTION WHEN unique_violation THEN
      GET STACKED DIAGNOSTICS violated_constraint = CONSTRAINT_NAME;
      IF violated_constraint <> 'enrollment_program_capacity_claims_slot_key' THEN
        RAISE;
      END IF;
    END;
  END LOOP;

  RAISE EXCEPTION USING
    ERRCODE = '23514',
    CONSTRAINT = 'enrollments_active_program_capacity_check',
    DETAIL = 'SACDIA_ENROLLMENT_PROGRAM_CAPACITY',
    MESSAGE = 'active enrollment capacity reached for formative program';
END;
$$;

DELETE FROM enrollment_program_capacity_claims;
INSERT INTO enrollment_program_capacity_claims (
  enrollment_id, user_id, ecclesiastical_year_id, formative_program_type, capacity_slot
)
SELECT enrollment_id, user_id, ecclesiastical_year_id, formative_program_type, capacity_slot
FROM (
  SELECT enrollment.enrollment_id, enrollment.user_id,
    enrollment.ecclesiastical_year_id, class.formative_program_type,
    row_number() OVER (
      PARTITION BY enrollment.user_id, enrollment.ecclesiastical_year_id,
        class.formative_program_type ORDER BY enrollment.enrollment_id
    )::INTEGER AS capacity_slot
  FROM enrollments enrollment
  JOIN classes class ON class.class_id = enrollment.class_id
  WHERE enrollment.active IS TRUE
) active_enrollments;

DROP TRIGGER IF EXISTS trg_enforce_active_enrollment_capacity ON enrollments;
CREATE TRIGGER trg_enforce_active_enrollment_capacity
AFTER INSERT OR UPDATE OF user_id, class_id, ecclesiastical_year_id, active
ON enrollments FOR EACH ROW EXECUTE FUNCTION sync_active_enrollment_capacity_claim();

DROP INDEX IF EXISTS uniq_enrollments_active_user_year;

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
FOR EACH ROW EXECUTE FUNCTION prevent_formative_program_reclassification();

COMMIT;
