-- Translation table for inventory_categories.
-- Approach X: Spanish (es) stays in main table; this table holds only non-es locales.

CREATE TABLE "inventory_categories_translations" (
  "id" SERIAL PRIMARY KEY,
  "inventory_category_id" INTEGER NOT NULL,
  "locale" VARCHAR(10) NOT NULL,
  "name" VARCHAR(100),
  "created_at" TIMESTAMPTZ(6) DEFAULT NOW(),
  "updated_at" TIMESTAMPTZ(6) DEFAULT NOW(),
  CONSTRAINT "inventory_categories_translations_inventory_category_id_fkey"
    FOREIGN KEY ("inventory_category_id")
    REFERENCES "inventory_categories" ("inventory_category_id")
    ON DELETE CASCADE
    ON UPDATE CASCADE,
  CONSTRAINT "inventory_categories_translations_unique_locale"
    UNIQUE ("inventory_category_id", "locale"),
  CONSTRAINT "inventory_categories_translations_locale_not_es"
    CHECK ("locale" <> 'es')
);

CREATE INDEX "inventory_categories_translations_locale_idx" ON "inventory_categories_translations" ("locale");
CREATE INDEX "inventory_categories_translations_inventory_category_id_idx" ON "inventory_categories_translations" ("inventory_category_id");
