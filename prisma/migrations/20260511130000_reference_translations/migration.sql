-- Translation tables for 7 reference catalogs.
-- Approach X: Spanish (es) stays in main table; this table holds only non-es locales.
-- Applied manually via: pnpm prisma db execute --file prisma/migrations/20260511130000_reference_translations/migration.sql
-- (Neon shadow DB workaround — do NOT run prisma migrate dev)

-- relationship_types_translations (FK is UUID — parent PK is UUID)
CREATE TABLE "relationship_types_translations" (
  "id" BIGSERIAL PRIMARY KEY,
  "relationship_type_id" UUID NOT NULL,
  "locale" VARCHAR(10) NOT NULL,
  "name" TEXT,
  "description" TEXT,
  "created_at" TIMESTAMPTZ(6) DEFAULT NOW(),
  "updated_at" TIMESTAMPTZ(6) DEFAULT NOW(),
  CONSTRAINT "relationship_types_translations_relationship_type_id_fkey"
    FOREIGN KEY ("relationship_type_id")
    REFERENCES "relationship_types" ("relationship_type_id")
    ON DELETE CASCADE
    ON UPDATE CASCADE,
  CONSTRAINT "relationship_types_translations_unique_locale"
    UNIQUE ("relationship_type_id", "locale"),
  CONSTRAINT "relationship_types_translations_locale_not_es"
    CHECK ("locale" <> 'es')
);

CREATE INDEX "relationship_types_translations_locale_idx" ON "relationship_types_translations" ("locale");
CREATE INDEX "relationship_types_translations_relationship_type_id_idx" ON "relationship_types_translations" ("relationship_type_id");

-- allergies_translations
CREATE TABLE "allergies_translations" (
  "id" BIGSERIAL PRIMARY KEY,
  "allergy_id" INTEGER NOT NULL,
  "locale" VARCHAR(10) NOT NULL,
  "name" TEXT,
  "description" TEXT,
  "created_at" TIMESTAMPTZ(6) DEFAULT NOW(),
  "updated_at" TIMESTAMPTZ(6) DEFAULT NOW(),
  CONSTRAINT "allergies_translations_allergy_id_fkey"
    FOREIGN KEY ("allergy_id")
    REFERENCES "allergies" ("allergy_id")
    ON DELETE CASCADE
    ON UPDATE CASCADE,
  CONSTRAINT "allergies_translations_unique_locale"
    UNIQUE ("allergy_id", "locale"),
  CONSTRAINT "allergies_translations_locale_not_es"
    CHECK ("locale" <> 'es')
);

CREATE INDEX "allergies_translations_locale_idx" ON "allergies_translations" ("locale");
CREATE INDEX "allergies_translations_allergy_id_idx" ON "allergies_translations" ("allergy_id");

-- diseases_translations
CREATE TABLE "diseases_translations" (
  "id" BIGSERIAL PRIMARY KEY,
  "disease_id" INTEGER NOT NULL,
  "locale" VARCHAR(10) NOT NULL,
  "name" TEXT,
  "description" TEXT,
  "created_at" TIMESTAMPTZ(6) DEFAULT NOW(),
  "updated_at" TIMESTAMPTZ(6) DEFAULT NOW(),
  CONSTRAINT "diseases_translations_disease_id_fkey"
    FOREIGN KEY ("disease_id")
    REFERENCES "diseases" ("disease_id")
    ON DELETE CASCADE
    ON UPDATE CASCADE,
  CONSTRAINT "diseases_translations_unique_locale"
    UNIQUE ("disease_id", "locale"),
  CONSTRAINT "diseases_translations_locale_not_es"
    CHECK ("locale" <> 'es')
);

CREATE INDEX "diseases_translations_locale_idx" ON "diseases_translations" ("locale");
CREATE INDEX "diseases_translations_disease_id_idx" ON "diseases_translations" ("disease_id");

-- medicines_translations
CREATE TABLE "medicines_translations" (
  "id" BIGSERIAL PRIMARY KEY,
  "medicine_id" INTEGER NOT NULL,
  "locale" VARCHAR(10) NOT NULL,
  "name" TEXT,
  "description" TEXT,
  "created_at" TIMESTAMPTZ(6) DEFAULT NOW(),
  "updated_at" TIMESTAMPTZ(6) DEFAULT NOW(),
  CONSTRAINT "medicines_translations_medicine_id_fkey"
    FOREIGN KEY ("medicine_id")
    REFERENCES "medicines" ("medicine_id")
    ON DELETE CASCADE
    ON UPDATE CASCADE,
  CONSTRAINT "medicines_translations_unique_locale"
    UNIQUE ("medicine_id", "locale"),
  CONSTRAINT "medicines_translations_locale_not_es"
    CHECK ("locale" <> 'es')
);

CREATE INDEX "medicines_translations_locale_idx" ON "medicines_translations" ("locale");
CREATE INDEX "medicines_translations_medicine_id_idx" ON "medicines_translations" ("medicine_id");

-- club_types_translations (name only — no description)
CREATE TABLE "club_types_translations" (
  "id" BIGSERIAL PRIMARY KEY,
  "club_type_id" INTEGER NOT NULL,
  "locale" VARCHAR(10) NOT NULL,
  "name" TEXT,
  "created_at" TIMESTAMPTZ(6) DEFAULT NOW(),
  "updated_at" TIMESTAMPTZ(6) DEFAULT NOW(),
  CONSTRAINT "club_types_translations_club_type_id_fkey"
    FOREIGN KEY ("club_type_id")
    REFERENCES "club_types" ("club_type_id")
    ON DELETE CASCADE
    ON UPDATE CASCADE,
  CONSTRAINT "club_types_translations_unique_locale"
    UNIQUE ("club_type_id", "locale"),
  CONSTRAINT "club_types_translations_locale_not_es"
    CHECK ("locale" <> 'es')
);

CREATE INDEX "club_types_translations_locale_idx" ON "club_types_translations" ("locale");
CREATE INDEX "club_types_translations_club_type_id_idx" ON "club_types_translations" ("club_type_id");

-- club_ideals_translations (name + ideal — NOT description)
CREATE TABLE "club_ideals_translations" (
  "id" BIGSERIAL PRIMARY KEY,
  "club_ideal_id" INTEGER NOT NULL,
  "locale" VARCHAR(10) NOT NULL,
  "name" TEXT,
  "ideal" TEXT,
  "created_at" TIMESTAMPTZ(6) DEFAULT NOW(),
  "updated_at" TIMESTAMPTZ(6) DEFAULT NOW(),
  CONSTRAINT "club_ideals_translations_club_ideal_id_fkey"
    FOREIGN KEY ("club_ideal_id")
    REFERENCES "club_ideals" ("club_ideal_id")
    ON DELETE CASCADE
    ON UPDATE CASCADE,
  CONSTRAINT "club_ideals_translations_unique_locale"
    UNIQUE ("club_ideal_id", "locale"),
  CONSTRAINT "club_ideals_translations_locale_not_es"
    CHECK ("locale" <> 'es')
);

CREATE INDEX "club_ideals_translations_locale_idx" ON "club_ideals_translations" ("locale");
CREATE INDEX "club_ideals_translations_club_ideal_id_idx" ON "club_ideals_translations" ("club_ideal_id");

-- activity_types_translations (name + description; code is NOT translated)
CREATE TABLE "activity_types_translations" (
  "id" BIGSERIAL PRIMARY KEY,
  "activity_type_id" INTEGER NOT NULL,
  "locale" VARCHAR(10) NOT NULL,
  "name" TEXT,
  "description" TEXT,
  "created_at" TIMESTAMPTZ(6) DEFAULT NOW(),
  "updated_at" TIMESTAMPTZ(6) DEFAULT NOW(),
  CONSTRAINT "activity_types_translations_activity_type_id_fkey"
    FOREIGN KEY ("activity_type_id")
    REFERENCES "activity_types" ("activity_type_id")
    ON DELETE CASCADE
    ON UPDATE CASCADE,
  CONSTRAINT "activity_types_translations_unique_locale"
    UNIQUE ("activity_type_id", "locale"),
  CONSTRAINT "activity_types_translations_locale_not_es"
    CHECK ("locale" <> 'es')
);

CREATE INDEX "activity_types_translations_locale_idx" ON "activity_types_translations" ("locale");
CREATE INDEX "activity_types_translations_activity_type_id_idx" ON "activity_types_translations" ("activity_type_id");
