-- Migration: migrate evidence status fields from VARCHAR to evidence_validation_enum
-- Affects: folders_section_records.status, class_section_progress.status

-- 1. Convert existing Spanish string values to enum values (including feminine variants)
UPDATE folders_section_records SET status = 'PENDING'   WHERE status = 'pendiente';
UPDATE folders_section_records SET status = 'VALIDATED' WHERE status IN ('validado', 'validada');
UPDATE folders_section_records SET status = 'REJECTED'  WHERE status IN ('rechazado', 'rechazada');

UPDATE class_section_progress SET status = 'PENDING'   WHERE status = 'pendiente';
UPDATE class_section_progress SET status = 'VALIDATED' WHERE status IN ('validado', 'validada');
UPDATE class_section_progress SET status = 'REJECTED'  WHERE status IN ('rechazado', 'rechazada');

-- 2. Drop VARCHAR defaults before type change (cannot cast automatically)
ALTER TABLE folders_section_records ALTER COLUMN status DROP DEFAULT;
ALTER TABLE class_section_progress ALTER COLUMN status DROP DEFAULT;

-- 3. Alter columns to use the enum type
ALTER TABLE folders_section_records
  ALTER COLUMN status TYPE evidence_validation_enum
  USING status::evidence_validation_enum;

ALTER TABLE class_section_progress
  ALTER COLUMN status TYPE evidence_validation_enum
  USING status::evidence_validation_enum;

-- 4. Re-add defaults with the enum type
ALTER TABLE folders_section_records
  ALTER COLUMN status SET DEFAULT 'PENDING'::evidence_validation_enum;

ALTER TABLE class_section_progress
  ALTER COLUMN status SET DEFAULT 'PENDING'::evidence_validation_enum;
