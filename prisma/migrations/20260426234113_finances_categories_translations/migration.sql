-- Translation table for finances_categories.
-- Approach X: Spanish (es) stays in main table; this table holds only non-es locales.

CREATE TABLE "finances_categories_translations" (
  "id" SERIAL PRIMARY KEY,
  "finance_category_id" INTEGER NOT NULL,
  "locale" VARCHAR(10) NOT NULL,
  "name" VARCHAR(100),
  "description" TEXT,
  "created_at" TIMESTAMPTZ(6) DEFAULT NOW(),
  "updated_at" TIMESTAMPTZ(6) DEFAULT NOW(),
  CONSTRAINT "finances_categories_translations_finance_category_id_fkey"
    FOREIGN KEY ("finance_category_id")
    REFERENCES "finances_categories" ("finance_category_id")
    ON DELETE CASCADE
    ON UPDATE CASCADE,
  CONSTRAINT "finances_categories_translations_unique_locale"
    UNIQUE ("finance_category_id", "locale"),
  CONSTRAINT "finances_categories_translations_locale_not_es"
    CHECK ("locale" <> 'es')
);

CREATE INDEX "finances_categories_translations_locale_idx" ON "finances_categories_translations" ("locale");
CREATE INDEX "finances_categories_translations_finance_category_id_idx" ON "finances_categories_translations" ("finance_category_id");
