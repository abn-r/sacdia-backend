-- Translation table for scoring_categories.
-- Approach X: Spanish (es) stays in main table; this table holds only non-es locales.

CREATE TABLE "scoring_categories_translations" (
  "id" SERIAL PRIMARY KEY,
  "scoring_category_id" INTEGER NOT NULL,
  "locale" VARCHAR(10) NOT NULL,
  "name" VARCHAR(100),
  "created_at" TIMESTAMPTZ(6) DEFAULT NOW(),
  "updated_at" TIMESTAMPTZ(6) DEFAULT NOW(),
  CONSTRAINT "scoring_categories_translations_scoring_category_id_fkey"
    FOREIGN KEY ("scoring_category_id")
    REFERENCES "scoring_categories" ("scoring_category_id")
    ON DELETE CASCADE
    ON UPDATE CASCADE,
  CONSTRAINT "scoring_categories_translations_unique_locale"
    UNIQUE ("scoring_category_id", "locale"),
  CONSTRAINT "scoring_categories_translations_locale_not_es"
    CHECK ("locale" <> 'es')
);

CREATE INDEX "scoring_categories_translations_locale_idx" ON "scoring_categories_translations" ("locale");
CREATE INDEX "scoring_categories_translations_scoring_category_id_idx" ON "scoring_categories_translations" ("scoring_category_id");
