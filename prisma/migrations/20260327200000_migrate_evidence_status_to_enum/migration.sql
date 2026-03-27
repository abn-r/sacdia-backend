-- Migration: migrate evidence status fields from VARCHAR to evidence_validation_enum
-- Affects: folders_section_records.status, class_section_progress.status

-- 1. Convert existing Spanish string values to enum values
UPDATE folders_section_records SET status = 'PENDING'   WHERE status = 'pendiente';
UPDATE folders_section_records SET status = 'VALIDATED' WHERE status = 'validado';
UPDATE folders_section_records SET status = 'REJECTED'  WHERE status = 'rechazado';

UPDATE class_section_progress SET status = 'PENDING'   WHERE status = 'pendiente';
UPDATE class_section_progress SET status = 'VALIDATED' WHERE status = 'validado';
UPDATE class_section_progress SET status = 'REJECTED'  WHERE status = 'rechazado';

-- 2. Alter columns to use the enum type
ALTER TABLE folders_section_records
  ALTER COLUMN status TYPE evidence_validation_enum
  USING status::evidence_validation_enum;
ALTER TABLE folders_section_records
  ALTER COLUMN status SET DEFAULT 'PENDING'::evidence_validation_enum;

ALTER TABLE class_section_progress
  ALTER COLUMN status TYPE evidence_validation_enum
  USING status::evidence_validation_enum;
ALTER TABLE class_section_progress
  ALTER COLUMN status SET DEFAULT 'PENDING'::evidence_validation_enum;
