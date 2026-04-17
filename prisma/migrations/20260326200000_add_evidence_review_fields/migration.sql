-- ============================================================
-- Migration: add_evidence_review_fields
-- Adds rejection_reason to folders_section_records and
-- user_honor_id FK to evidence_files (references users_honors,
-- NOT the honors catalog table — see C1 fix).
-- ============================================================

-- Add rejection_reason to folders_section_records
ALTER TABLE "folders_section_records"
  ADD COLUMN IF NOT EXISTS "rejection_reason" TEXT;

-- Add user_honor_id FK to evidence_files (for honor evidence support)
-- References users_honors(user_honor_id), the user's progress record —
-- NOT honors(honor_id) which is the static catalog.
ALTER TABLE "evidence_files"
  ADD COLUMN IF NOT EXISTS "user_honor_id" INTEGER;

ALTER TABLE "evidence_files"
  ADD CONSTRAINT "evidence_files_user_honor_id_fkey"
  FOREIGN KEY ("user_honor_id")
  REFERENCES "users_honors"("user_honor_id")
  ON DELETE CASCADE
  ON UPDATE NO ACTION
  NOT VALID;

CREATE INDEX IF NOT EXISTS "idx_evidence_files_user_honor_id"
  ON "evidence_files"("user_honor_id");
