-- Add stable honor codes before relaxing global display-name uniqueness.
ALTER TABLE "honors"
  ADD COLUMN "code" VARCHAR(120);

UPDATE "honors"
SET "code" = concat('LEGACY-', "honor_id"::text)
WHERE "code" IS NULL;

CREATE UNIQUE INDEX "honors_code_key" ON "honors"("code");

-- Display names are not globally unique across club programs/classes.
DROP INDEX IF EXISTS "honors_name_key";

CREATE TYPE "class_honor_relation_type_enum" AS ENUM ('REQUIRED', 'RECOMMENDED', 'ELECTIVE');

CREATE TABLE "honor_club_types" (
  "honor_club_type_id" SERIAL NOT NULL,
  "honor_id" INTEGER NOT NULL,
  "club_type_id" INTEGER NOT NULL,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "modified_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "honor_club_types_pkey" PRIMARY KEY ("honor_club_type_id")
);

CREATE UNIQUE INDEX "honor_club_types_honor_id_club_type_id_key"
  ON "honor_club_types"("honor_id", "club_type_id");

CREATE INDEX "honor_club_types_club_type_id_idx"
  ON "honor_club_types"("club_type_id");

ALTER TABLE "honor_club_types"
  ADD CONSTRAINT "honor_club_types_honor_id_fkey"
  FOREIGN KEY ("honor_id") REFERENCES "honors"("honor_id")
  ON DELETE CASCADE ON UPDATE NO ACTION;

ALTER TABLE "honor_club_types"
  ADD CONSTRAINT "honor_club_types_club_type_id_fkey"
  FOREIGN KEY ("club_type_id") REFERENCES "club_types"("club_type_id")
  ON DELETE CASCADE ON UPDATE NO ACTION;

INSERT INTO "honor_club_types" ("honor_id", "club_type_id")
SELECT "honor_id", "club_type_id"
FROM "honors"
ON CONFLICT ("honor_id", "club_type_id") DO NOTHING;

CREATE TABLE "class_honors" (
  "class_honor_id" SERIAL NOT NULL,
  "class_id" INTEGER NOT NULL,
  "honor_id" INTEGER NOT NULL,
  "relation_type" "class_honor_relation_type_enum" NOT NULL DEFAULT 'RECOMMENDED',
  "active" BOOLEAN NOT NULL DEFAULT true,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "modified_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "class_honors_pkey" PRIMARY KEY ("class_honor_id")
);

CREATE UNIQUE INDEX "class_honors_class_id_honor_id_relation_type_key"
  ON "class_honors"("class_id", "honor_id", "relation_type");

CREATE INDEX "class_honors_honor_id_idx"
  ON "class_honors"("honor_id");

ALTER TABLE "class_honors"
  ADD CONSTRAINT "class_honors_class_id_fkey"
  FOREIGN KEY ("class_id") REFERENCES "classes"("class_id")
  ON DELETE CASCADE ON UPDATE NO ACTION;

ALTER TABLE "class_honors"
  ADD CONSTRAINT "class_honors_honor_id_fkey"
  FOREIGN KEY ("honor_id") REFERENCES "honors"("honor_id")
  ON DELETE CASCADE ON UPDATE NO ACTION;
