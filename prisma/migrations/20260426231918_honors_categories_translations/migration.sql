-- Translation table for honors_categories.
-- Approach X: Spanish (es) stays in main table; this table holds only non-es locales.

CREATE TABLE "honors_categories_translations" (
  "id" SERIAL PRIMARY KEY,
  "honor_category_id" INTEGER NOT NULL,
  "locale" VARCHAR(10) NOT NULL,
  "name" VARCHAR(100),
  "description" TEXT,
  "created_at" TIMESTAMPTZ(6) DEFAULT NOW(),
  "updated_at" TIMESTAMPTZ(6) DEFAULT NOW(),
  CONSTRAINT "honors_categories_translations_honor_category_id_fkey"
    FOREIGN KEY ("honor_category_id")
    REFERENCES "honors_categories" ("honor_category_id")
    ON DELETE CASCADE
    ON UPDATE CASCADE,
  CONSTRAINT "honors_categories_translations_unique_locale"
    UNIQUE ("honor_category_id", "locale"),
  CONSTRAINT "honors_categories_translations_locale_not_es"
    CHECK ("locale" <> 'es')
);

CREATE INDEX "honors_categories_translations_locale_idx"
  ON "honors_categories_translations" ("locale");

CREATE INDEX "honors_categories_translations_honor_category_id_idx"
  ON "honors_categories_translations" ("honor_category_id");
