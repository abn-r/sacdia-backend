-- CreateEnum
CREATE TYPE "evidence_type_enum" AS ENUM ('IMAGE', 'FILE', 'LINK');

-- AlterTable: honor_requirements — add new columns
ALTER TABLE "honor_requirements"
  ADD COLUMN "parent_id"          INTEGER,
  ADD COLUMN "display_label"      VARCHAR(10),
  ADD COLUMN "reference_text"     TEXT,
  ADD COLUMN "is_choice_group"    BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "choice_min"         INTEGER,
  ADD COLUMN "requires_evidence"  BOOLEAN NOT NULL DEFAULT false;

-- AlterTable: user_honor_requirement_progress — add text_response column
ALTER TABLE "user_honor_requirement_progress"
  ADD COLUMN "text_response" VARCHAR(800);

-- CreateIndex: parent_id on honor_requirements
CREATE INDEX "honor_requirements_parent_id_idx" ON "honor_requirements"("parent_id");

-- AddForeignKey: self-referential parent on honor_requirements
ALTER TABLE "honor_requirements"
  ADD CONSTRAINT "honor_requirements_parent_id_fkey"
  FOREIGN KEY ("parent_id")
  REFERENCES "honor_requirements"("requirement_id")
  ON DELETE NO ACTION ON UPDATE NO ACTION;

-- CreateTable: requirement_evidence
CREATE TABLE "requirement_evidence" (
  "evidence_id"   SERIAL NOT NULL,
  "progress_id"   INTEGER NOT NULL,
  "evidence_type" "evidence_type_enum" NOT NULL,
  "url"           TEXT NOT NULL,
  "filename"      VARCHAR(255),
  "mime_type"     VARCHAR(100),
  "file_size"     INTEGER,
  "active"        BOOLEAN NOT NULL DEFAULT true,
  "created_at"    TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "modified_at"   TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "requirement_evidence_pkey" PRIMARY KEY ("evidence_id")
);

-- CreateIndex: progress_id on requirement_evidence
CREATE INDEX "requirement_evidence_progress_id_idx" ON "requirement_evidence"("progress_id");

-- AddForeignKey: requirement_evidence -> user_honor_requirement_progress
ALTER TABLE "requirement_evidence"
  ADD CONSTRAINT "requirement_evidence_progress_id_fkey"
  FOREIGN KEY ("progress_id")
  REFERENCES "user_honor_requirement_progress"("progress_id")
  ON DELETE CASCADE ON UPDATE NO ACTION;
