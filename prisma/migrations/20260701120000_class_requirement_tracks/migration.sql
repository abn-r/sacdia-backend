-- Separate class requirements into BASIC, ADVANCED, and EXTRA tracks.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_type
    WHERE typname = 'class_requirement_track_enum'
  ) THEN
    CREATE TYPE "class_requirement_track_enum" AS ENUM ('BASIC', 'ADVANCED', 'EXTRA');
  END IF;
END
$$;

ALTER TABLE "classes"
  ADD COLUMN IF NOT EXISTS "advanced_enabled" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "class_sections"
  ADD COLUMN IF NOT EXISTS "requirement_track" "class_requirement_track_enum" NOT NULL DEFAULT 'BASIC',
  ADD COLUMN IF NOT EXISTS "required_for_investiture" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS "display_order" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "owner_division_id" INTEGER,
  ADD COLUMN IF NOT EXISTS "owner_union_id" INTEGER,
  ADD COLUMN IF NOT EXISTS "owner_local_field_id" INTEGER,
  ADD COLUMN IF NOT EXISTS "available_from_year_id" INTEGER,
  ADD COLUMN IF NOT EXISTS "available_until_year_id" INTEGER;

UPDATE "class_sections"
SET
  "requirement_track" = 'BASIC',
  "required_for_investiture" = true;

WITH ordered_sections AS (
  SELECT
    "section_id",
    row_number() OVER (PARTITION BY "module_id" ORDER BY "section_id") - 1 AS "display_order"
  FROM "class_sections"
)
UPDATE "class_sections" cs
SET "display_order" = ordered_sections."display_order"
FROM ordered_sections
WHERE cs."section_id" = ordered_sections."section_id";

CREATE INDEX IF NOT EXISTS "idx_class_sections_requirement_track"
  ON "class_sections"("requirement_track");
CREATE INDEX IF NOT EXISTS "idx_class_sections_module_requirement_track"
  ON "class_sections"("module_id", "requirement_track");
CREATE INDEX IF NOT EXISTS "idx_class_sections_owner_division_id"
  ON "class_sections"("owner_division_id");
CREATE INDEX IF NOT EXISTS "idx_class_sections_owner_union_id"
  ON "class_sections"("owner_union_id");
CREATE INDEX IF NOT EXISTS "idx_class_sections_owner_local_field_id"
  ON "class_sections"("owner_local_field_id");
CREATE INDEX IF NOT EXISTS "idx_class_sections_available_from_year_id"
  ON "class_sections"("available_from_year_id");
CREATE INDEX IF NOT EXISTS "idx_class_sections_available_until_year_id"
  ON "class_sections"("available_until_year_id");

ALTER TABLE "class_sections"
  ADD CONSTRAINT "class_sections_owner_division_id_fkey"
  FOREIGN KEY ("owner_division_id") REFERENCES "divisions"("division_id")
  ON DELETE NO ACTION ON UPDATE NO ACTION;

ALTER TABLE "class_sections"
  ADD CONSTRAINT "class_sections_owner_union_id_fkey"
  FOREIGN KEY ("owner_union_id") REFERENCES "unions"("union_id")
  ON DELETE NO ACTION ON UPDATE NO ACTION;

ALTER TABLE "class_sections"
  ADD CONSTRAINT "class_sections_owner_local_field_id_fkey"
  FOREIGN KEY ("owner_local_field_id") REFERENCES "local_fields"("local_field_id")
  ON DELETE NO ACTION ON UPDATE NO ACTION;

ALTER TABLE "class_sections"
  ADD CONSTRAINT "class_sections_available_from_year_id_fkey"
  FOREIGN KEY ("available_from_year_id") REFERENCES "ecclesiastical_years"("year_id")
  ON DELETE NO ACTION ON UPDATE NO ACTION;

ALTER TABLE "class_sections"
  ADD CONSTRAINT "class_sections_available_until_year_id_fkey"
  FOREIGN KEY ("available_until_year_id") REFERENCES "ecclesiastical_years"("year_id")
  ON DELETE NO ACTION ON UPDATE NO ACTION;

ALTER TABLE "class_sections"
  ADD CONSTRAINT "class_sections_basic_advanced_no_owner_chk"
  CHECK (
    "requirement_track" NOT IN ('BASIC', 'ADVANCED')
    OR (
      "owner_division_id" IS NULL
      AND "owner_union_id" IS NULL
      AND "owner_local_field_id" IS NULL
    )
  );

ALTER TABLE "class_sections"
  ADD CONSTRAINT "class_sections_extra_single_owner_chk"
  CHECK (
    "requirement_track" <> 'EXTRA'
    OR (
      (
        CASE WHEN "owner_division_id" IS NOT NULL THEN 1 ELSE 0 END +
        CASE WHEN "owner_union_id" IS NOT NULL THEN 1 ELSE 0 END +
        CASE WHEN "owner_local_field_id" IS NOT NULL THEN 1 ELSE 0 END
      ) = 1
    )
  );

ALTER TABLE "class_sections"
  ADD CONSTRAINT "class_sections_advanced_not_required_chk"
  CHECK (
    "requirement_track" <> 'ADVANCED'
    OR "required_for_investiture" = false
  );
