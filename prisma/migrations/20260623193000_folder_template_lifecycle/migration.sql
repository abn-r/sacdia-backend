-- Folder template lifecycle
-- Drafts can be edited/deleted. Published templates can generate folders and are locked.
-- Archived templates remain for history but cannot generate new folders.

DO $$
BEGIN
  CREATE TYPE "folder_template_status_enum" AS ENUM ('DRAFT', 'PUBLISHED', 'ARCHIVED');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE "folder_templates"
  ADD COLUMN IF NOT EXISTS "status" "folder_template_status_enum" NOT NULL DEFAULT 'DRAFT';

UPDATE "folder_templates"
SET "status" = CASE WHEN "active" = true THEN 'PUBLISHED'::"folder_template_status_enum" ELSE 'DRAFT'::"folder_template_status_enum" END
WHERE "status" IS NULL OR "status" = 'DRAFT'::"folder_template_status_enum";

CREATE INDEX IF NOT EXISTS "idx_folder_templates_status"
  ON "folder_templates" ("status");
