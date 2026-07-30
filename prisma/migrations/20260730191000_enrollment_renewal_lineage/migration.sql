BEGIN;

ALTER TABLE enrollments
  ADD COLUMN renewed_from_enrollment_id INTEGER;

ALTER TABLE enrollments
  ADD CONSTRAINT enrollments_renewed_from_enrollment_id_fkey
    FOREIGN KEY (renewed_from_enrollment_id)
    REFERENCES enrollments(enrollment_id)
    ON DELETE RESTRICT
    ON UPDATE NO ACTION,
  ADD CONSTRAINT enrollments_renewed_from_enrollment_id_check
    CHECK (
      renewed_from_enrollment_id IS NULL
      OR renewed_from_enrollment_id <> enrollment_id
    );

CREATE UNIQUE INDEX enrollments_renewed_from_enrollment_id_key
  ON enrollments (renewed_from_enrollment_id);

CREATE INDEX idx_enrollments_user_class_active
  ON enrollments (user_id, class_id, active);

CREATE FUNCTION enforce_enrollment_renewal_lineage()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  source_user_id UUID;
  source_class_id INTEGER;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF OLD.renewed_from_enrollment_id IS NOT NULL
      AND NEW.renewed_from_enrollment_id
        IS DISTINCT FROM OLD.renewed_from_enrollment_id
    THEN
      RAISE EXCEPTION USING
        ERRCODE = '23514',
        CONSTRAINT = 'enrollments_renewal_source_immutable_check',
        MESSAGE = 'renewal source is immutable once assigned';
    END IF;

    IF (
      NEW.user_id IS DISTINCT FROM OLD.user_id
      OR NEW.class_id IS DISTINCT FROM OLD.class_id
    ) AND (
      OLD.renewed_from_enrollment_id IS NOT NULL
      OR EXISTS (
        SELECT 1 FROM enrollments
        WHERE renewed_from_enrollment_id = OLD.enrollment_id
      )
    ) THEN
      RAISE EXCEPTION USING
        ERRCODE = '23514',
        CONSTRAINT = 'enrollments_renewal_identity_immutable_check',
        MESSAGE = 'renewal lineage identity is immutable';
    END IF;
  END IF;

  IF NEW.renewed_from_enrollment_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT user_id, class_id
  INTO source_user_id, source_class_id
  FROM enrollments
  WHERE enrollment_id = NEW.renewed_from_enrollment_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN NEW;
  END IF;

  IF source_user_id IS DISTINCT FROM NEW.user_id
    OR source_class_id IS DISTINCT FROM NEW.class_id
  THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      CONSTRAINT = 'enrollments_renewal_identity_check',
      MESSAGE = 'renewal source must belong to the same user and class';
  END IF;

  IF EXISTS (
    WITH RECURSIVE lineage AS (
      SELECT enrollment_id, renewed_from_enrollment_id
      FROM enrollments
      WHERE enrollment_id = NEW.renewed_from_enrollment_id
      UNION
      SELECT parent.enrollment_id, parent.renewed_from_enrollment_id
      FROM enrollments parent
      JOIN lineage child
        ON parent.enrollment_id = child.renewed_from_enrollment_id
    )
    SELECT 1
    FROM lineage
    WHERE enrollment_id = NEW.enrollment_id
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      CONSTRAINT = 'enrollments_renewal_acyclic_check',
      MESSAGE = 'renewal lineage must be acyclic';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER enforce_enrollment_renewal_lineage_trigger
BEFORE INSERT OR UPDATE OF renewed_from_enrollment_id, user_id, class_id
ON enrollments
FOR EACH ROW
EXECUTE FUNCTION enforce_enrollment_renewal_lineage();

COMMIT;
