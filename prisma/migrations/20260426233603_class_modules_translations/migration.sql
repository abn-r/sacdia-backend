-- Translation table for class_modules.
-- Approach X: Spanish (es) stays in main table; this table holds only non-es locales.

CREATE TABLE "class_modules_translations" (
  "id" SERIAL PRIMARY KEY,
  "module_id" INTEGER NOT NULL,
  "locale" VARCHAR(10) NOT NULL,
  "name" VARCHAR(255),
  "description" TEXT,
  "created_at" TIMESTAMPTZ(6) DEFAULT NOW(),
  "updated_at" TIMESTAMPTZ(6) DEFAULT NOW(),
  CONSTRAINT "class_modules_translations_module_id_fkey"
    FOREIGN KEY ("module_id")
    REFERENCES "class_modules" ("module_id")
    ON DELETE CASCADE
    ON UPDATE CASCADE,
  CONSTRAINT "class_modules_translations_unique_locale"
    UNIQUE ("module_id", "locale"),
  CONSTRAINT "class_modules_translations_locale_not_es"
    CHECK ("locale" <> 'es')
);

CREATE INDEX "class_modules_translations_locale_idx" ON "class_modules_translations" ("locale");
CREATE INDEX "class_modules_translations_module_id_idx" ON "class_modules_translations" ("module_id");
