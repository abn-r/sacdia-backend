-- Migration: folder_templates polymorphic owner (T-B1-1)
-- SDD: annual-folders-ownership-rework
-- Destructive: truncate dependents via CASCADE (dev data is throwaway per SDD proposal v2)

TRUNCATE TABLE "folder_templates" CASCADE;

-- Drop the old unique that collapsed ownership to one row per type-year
-- NOTE: In some DB states the backing unique index survives as a standalone object after TRUNCATE;
-- drop both the constraint and the index to be safe.
ALTER TABLE "folder_templates" DROP CONSTRAINT IF EXISTS "folder_templates_club_type_id_ecclesiastical_year_id_key";
DROP INDEX IF EXISTS "folder_templates_club_type_id_ecclesiastical_year_id_key";

-- Add owner FK columns
ALTER TABLE "folder_templates"
  ADD COLUMN "owner_union_id" INTEGER,
  ADD COLUMN "owner_local_field_id" INTEGER;

-- FK constraints
ALTER TABLE "folder_templates"
  ADD CONSTRAINT "folder_templates_owner_union_id_fkey"
    FOREIGN KEY ("owner_union_id") REFERENCES "unions"("union_id") ON DELETE RESTRICT ON UPDATE NO ACTION;

ALTER TABLE "folder_templates"
  ADD CONSTRAINT "folder_templates_owner_local_field_id_fkey"
    FOREIGN KEY ("owner_local_field_id") REFERENCES "local_fields"("local_field_id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- Exactly-one-owner CHECK (mirrors camporee_clubs_exactly_one_camporee_check)
ALTER TABLE "folder_templates"
  ADD CONSTRAINT "folder_templates_exactly_one_owner_check"
  CHECK (
    (owner_union_id IS NOT NULL AND owner_local_field_id IS NULL)
    OR
    (owner_union_id IS NULL AND owner_local_field_id IS NOT NULL)
  );

-- Partial unique indexes enforce per-owner uniqueness without blocking the other owner tier
CREATE UNIQUE INDEX "folder_templates_union_owner_unique"
  ON "folder_templates"("club_type_id", "ecclesiastical_year_id", "owner_union_id")
  WHERE "owner_union_id" IS NOT NULL;

CREATE UNIQUE INDEX "folder_templates_local_field_owner_unique"
  ON "folder_templates"("club_type_id", "ecclesiastical_year_id", "owner_local_field_id")
  WHERE "owner_local_field_id" IS NOT NULL;

-- Btree indexes for owner FK lookups
CREATE INDEX "idx_folder_templates_owner_union" ON "folder_templates"("owner_union_id");
CREATE INDEX "idx_folder_templates_owner_local_field" ON "folder_templates"("owner_local_field_id");
