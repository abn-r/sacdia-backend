-- Add status/submission/validation tracking to folders_section_records
ALTER TABLE "folders_section_records"
  ADD COLUMN "status" VARCHAR(20) DEFAULT 'pendiente',
  ADD COLUMN "submitted_by_id" UUID,
  ADD COLUMN "submitted_at" TIMESTAMPTZ(6),
  ADD COLUMN "validated_by_id" UUID,
  ADD COLUMN "validated_at" TIMESTAMPTZ(6),
  ADD COLUMN "earned_points" INTEGER DEFAULT 0;

-- Backfill default values for existing records
UPDATE "folders_section_records"
SET "status" = 'pendiente'
WHERE "status" IS NULL;

UPDATE "folders_section_records"
SET "earned_points" = 0
WHERE "earned_points" IS NULL;

-- Create evidence files table
CREATE TABLE "evidence_files" (
  "evidence_file_id" SERIAL NOT NULL,
  "section_record_id" INTEGER NOT NULL,
  "file_url" VARCHAR(500) NOT NULL,
  "file_name" VARCHAR(255) NOT NULL,
  "file_type" VARCHAR(50) NOT NULL,
  "uploaded_by_id" UUID NOT NULL,
  "uploaded_at" TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
  "active" BOOLEAN NOT NULL DEFAULT TRUE,

  CONSTRAINT "evidence_files_pkey" PRIMARY KEY ("evidence_file_id")
);

-- Foreign keys
ALTER TABLE "folders_section_records"
  ADD CONSTRAINT "folders_section_records_submitted_by_id_fkey"
  FOREIGN KEY ("submitted_by_id") REFERENCES "users"("user_id")
  ON UPDATE NO ACTION ON DELETE NO ACTION;

ALTER TABLE "folders_section_records"
  ADD CONSTRAINT "folders_section_records_validated_by_id_fkey"
  FOREIGN KEY ("validated_by_id") REFERENCES "users"("user_id")
  ON UPDATE NO ACTION ON DELETE NO ACTION;

ALTER TABLE "evidence_files"
  ADD CONSTRAINT "evidence_files_section_record_id_fkey"
  FOREIGN KEY ("section_record_id") REFERENCES "folders_section_records"("folder_section_record_id")
  ON UPDATE NO ACTION ON DELETE CASCADE;

ALTER TABLE "evidence_files"
  ADD CONSTRAINT "evidence_files_uploaded_by_id_fkey"
  FOREIGN KEY ("uploaded_by_id") REFERENCES "users"("user_id")
  ON UPDATE NO ACTION ON DELETE NO ACTION;

-- Indexes
CREATE INDEX "idx_evidence_files_section_record" ON "evidence_files"("section_record_id");
CREATE INDEX "idx_evidence_files_uploaded_by" ON "evidence_files"("uploaded_by_id");
