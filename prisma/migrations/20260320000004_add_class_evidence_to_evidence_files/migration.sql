-- Make section_record_id nullable (was NOT NULL before)
ALTER TABLE "evidence_files" ALTER COLUMN "section_record_id" DROP NOT NULL;

-- Add section_progress_id FK column
ALTER TABLE "evidence_files" ADD COLUMN "section_progress_id" INTEGER;

-- Add FK constraint
ALTER TABLE "evidence_files" ADD CONSTRAINT "evidence_files_section_progress_id_fkey"
  FOREIGN KEY ("section_progress_id") REFERENCES "class_section_progress"("section_progress_id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- Add index
CREATE INDEX "idx_evidence_files_section_progress" ON "evidence_files"("section_progress_id");
