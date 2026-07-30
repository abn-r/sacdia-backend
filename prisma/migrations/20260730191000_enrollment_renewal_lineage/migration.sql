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

COMMIT;
