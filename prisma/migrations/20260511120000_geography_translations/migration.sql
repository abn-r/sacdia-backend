-- Translation tables for 5 geography catalogs.
-- Approach X: Spanish (es) stays in main table; this table holds only non-es locales.
-- Applied manually via: pnpm prisma db execute --file prisma/migrations/20260511120000_geography_translations/migration.sql
-- (Neon shadow DB workaround — do NOT run prisma migrate dev)

-- countries_translations
CREATE TABLE "countries_translations" (
  "id" SERIAL PRIMARY KEY,
  "country_id" INTEGER NOT NULL,
  "locale" VARCHAR(10) NOT NULL,
  "name" TEXT,
  "created_at" TIMESTAMPTZ(6) DEFAULT NOW(),
  "updated_at" TIMESTAMPTZ(6) DEFAULT NOW(),
  CONSTRAINT "countries_translations_country_id_fkey"
    FOREIGN KEY ("country_id")
    REFERENCES "countries" ("country_id")
    ON DELETE CASCADE
    ON UPDATE CASCADE,
  CONSTRAINT "countries_translations_unique_locale"
    UNIQUE ("country_id", "locale"),
  CONSTRAINT "countries_translations_locale_not_es"
    CHECK ("locale" <> 'es')
);

CREATE INDEX "countries_translations_locale_idx" ON "countries_translations" ("locale");
CREATE INDEX "countries_translations_country_id_idx" ON "countries_translations" ("country_id");

-- unions_translations
CREATE TABLE "unions_translations" (
  "id" SERIAL PRIMARY KEY,
  "union_id" INTEGER NOT NULL,
  "locale" VARCHAR(10) NOT NULL,
  "name" TEXT,
  "created_at" TIMESTAMPTZ(6) DEFAULT NOW(),
  "updated_at" TIMESTAMPTZ(6) DEFAULT NOW(),
  CONSTRAINT "unions_translations_union_id_fkey"
    FOREIGN KEY ("union_id")
    REFERENCES "unions" ("union_id")
    ON DELETE CASCADE
    ON UPDATE CASCADE,
  CONSTRAINT "unions_translations_unique_locale"
    UNIQUE ("union_id", "locale"),
  CONSTRAINT "unions_translations_locale_not_es"
    CHECK ("locale" <> 'es')
);

CREATE INDEX "unions_translations_locale_idx" ON "unions_translations" ("locale");
CREATE INDEX "unions_translations_union_id_idx" ON "unions_translations" ("union_id");

-- local_fields_translations
CREATE TABLE "local_fields_translations" (
  "id" SERIAL PRIMARY KEY,
  "local_field_id" INTEGER NOT NULL,
  "locale" VARCHAR(10) NOT NULL,
  "name" TEXT,
  "created_at" TIMESTAMPTZ(6) DEFAULT NOW(),
  "updated_at" TIMESTAMPTZ(6) DEFAULT NOW(),
  CONSTRAINT "local_fields_translations_local_field_id_fkey"
    FOREIGN KEY ("local_field_id")
    REFERENCES "local_fields" ("local_field_id")
    ON DELETE CASCADE
    ON UPDATE CASCADE,
  CONSTRAINT "local_fields_translations_unique_locale"
    UNIQUE ("local_field_id", "locale"),
  CONSTRAINT "local_fields_translations_locale_not_es"
    CHECK ("locale" <> 'es')
);

CREATE INDEX "local_fields_translations_locale_idx" ON "local_fields_translations" ("locale");
CREATE INDEX "local_fields_translations_local_field_id_idx" ON "local_fields_translations" ("local_field_id");

-- districts_translations (FK references districlub_type_id — legacy typo, keep as-is)
CREATE TABLE "districts_translations" (
  "id" SERIAL PRIMARY KEY,
  "districlub_type_id" INTEGER NOT NULL,
  "locale" VARCHAR(10) NOT NULL,
  "name" TEXT,
  "created_at" TIMESTAMPTZ(6) DEFAULT NOW(),
  "updated_at" TIMESTAMPTZ(6) DEFAULT NOW(),
  CONSTRAINT "districts_translations_districlub_type_id_fkey"
    FOREIGN KEY ("districlub_type_id")
    REFERENCES "districts" ("districlub_type_id")
    ON DELETE CASCADE
    ON UPDATE CASCADE,
  CONSTRAINT "districts_translations_unique_locale"
    UNIQUE ("districlub_type_id", "locale"),
  CONSTRAINT "districts_translations_locale_not_es"
    CHECK ("locale" <> 'es')
);

CREATE INDEX "districts_translations_locale_idx" ON "districts_translations" ("locale");
CREATE INDEX "districts_translations_districlub_type_id_idx" ON "districts_translations" ("districlub_type_id");

-- churches_translations
CREATE TABLE "churches_translations" (
  "id" SERIAL PRIMARY KEY,
  "church_id" INTEGER NOT NULL,
  "locale" VARCHAR(10) NOT NULL,
  "name" TEXT,
  "created_at" TIMESTAMPTZ(6) DEFAULT NOW(),
  "updated_at" TIMESTAMPTZ(6) DEFAULT NOW(),
  CONSTRAINT "churches_translations_church_id_fkey"
    FOREIGN KEY ("church_id")
    REFERENCES "churches" ("church_id")
    ON DELETE CASCADE
    ON UPDATE CASCADE,
  CONSTRAINT "churches_translations_unique_locale"
    UNIQUE ("church_id", "locale"),
  CONSTRAINT "churches_translations_locale_not_es"
    CHECK ("locale" <> 'es')
);

CREATE INDEX "churches_translations_locale_idx" ON "churches_translations" ("locale");
CREATE INDEX "churches_translations_church_id_idx" ON "churches_translations" ("church_id");
