-- Create the enum type
CREATE TYPE "annual_folder_section_status_enum" AS ENUM (
  'PENDING', 'SUBMITTED', 'PREAPPROVED_LF', 'VALIDATED', 'REJECTED'
);

-- Add the column with default
ALTER TABLE "annual_folder_section_evaluations"
  ADD COLUMN "status" "annual_folder_section_status_enum" NOT NULL DEFAULT 'PENDING';

-- Dev backfill: rows with lf_approved_at set (legacy) → VALIDATED
-- (Dev data is throwaway per proposal; this is best-effort for any remaining rows.)
UPDATE "annual_folder_section_evaluations"
  SET "status" = 'VALIDATED'
  WHERE "lf_approved_at" IS NOT NULL;

-- Defensive CHECK: PREAPPROVED_LF status requires a stored LF approval
ALTER TABLE "annual_folder_section_evaluations"
  ADD CONSTRAINT "annual_folder_section_evaluations_preapproved_requires_lf_check"
  CHECK (status <> 'PREAPPROVED_LF' OR lf_approved_at IS NOT NULL);

-- Index supports analytics queries filtering by status
CREATE INDEX "idx_annual_folder_section_evaluations_status"
  ON "annual_folder_section_evaluations"("status");
