-- ============================================================
-- Migration: add_evidence_review_fields
-- Adds rejection_reason to folders_section_records and
-- honor_id FK to evidence_files for evidence review support.
-- ============================================================

-- Add rejection_reason to folders_section_records
ALTER TABLE "folders_section_records"
  ADD COLUMN IF NOT EXISTS "rejection_reason" TEXT;

-- Add honor_id FK to evidence_files (for honor evidence support)
ALTER TABLE "evidence_files"
  ADD COLUMN IF NOT EXISTS "honor_id" INTEGER;

ALTER TABLE "evidence_files"
  ADD CONSTRAINT "evidence_files_honor_id_fkey"
  FOREIGN KEY ("honor_id")
  REFERENCES "honors"("honor_id")
  ON DELETE CASCADE
  ON UPDATE NO ACTION
  NOT VALID;

CREATE INDEX IF NOT EXISTS "idx_evidence_files_honor_id"
  ON "evidence_files"("honor_id");
