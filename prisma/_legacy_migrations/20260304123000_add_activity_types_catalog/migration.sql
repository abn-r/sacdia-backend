-- Create activity_types catalog table
CREATE TABLE "activity_types" (
    "activity_type_id" SERIAL NOT NULL,
    "code" VARCHAR(50) NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "description" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,
    "modified_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "activity_types_pkey" PRIMARY KEY ("activity_type_id")
);

CREATE UNIQUE INDEX "activity_types_code_key" ON "activity_types"("code");
CREATE UNIQUE INDEX "activity_types_name_key" ON "activity_types"("name");

-- Seed initial activity types
INSERT INTO "activity_types" ("activity_type_id", "code", "name", "description", "active")
VALUES
  (1, 'regular', 'Regular', 'Actividad regular', true),
  (2, 'special', 'Especial', 'Actividad especial', true),
  (3, 'camporee', 'Camporee', 'Actividad de camporee', true)
ON CONFLICT ("activity_type_id") DO NOTHING;

-- Keep sequence aligned after explicit ids
SELECT setval(
  pg_get_serial_sequence('activity_types', 'activity_type_id'),
  (SELECT COALESCE(MAX("activity_type_id"), 1) FROM "activity_types"),
  true
);

-- Add new FK column on activities
ALTER TABLE "activities"
ADD COLUMN "activity_type_id" INTEGER;

-- Backfill values from legacy numeric codes
UPDATE "activities"
SET "activity_type_id" = CASE "activity_type"
  WHEN 1 THEN 2
  WHEN 2 THEN 3
  ELSE 1
END
WHERE "activity_type_id" IS NULL;

-- Enforce relation
ALTER TABLE "activities"
ALTER COLUMN "activity_type_id" SET NOT NULL;

ALTER TABLE "activities"
ADD CONSTRAINT "activities_activity_type_id_fkey"
FOREIGN KEY ("activity_type_id") REFERENCES "activity_types"("activity_type_id")
ON DELETE NO ACTION ON UPDATE NO ACTION;

CREATE INDEX "idx_activities_activity_type_id" ON "activities"("activity_type_id");

-- Drop legacy hardcoded type column
ALTER TABLE "activities"
DROP COLUMN "activity_type";
