-- Translation table for folders_modules.
-- Approach X: Spanish (es) stays in main table; this table holds only non-es locales.

CREATE TABLE "folders_modules_translations" (
  "id" SERIAL PRIMARY KEY,
  "folder_module_id" INTEGER NOT NULL,
  "locale" VARCHAR(10) NOT NULL,
  "name" VARCHAR(255),
  "description" TEXT,
  "created_at" TIMESTAMPTZ(6) DEFAULT NOW(),
  "updated_at" TIMESTAMPTZ(6) DEFAULT NOW(),
  CONSTRAINT "folders_modules_translations_folder_module_id_fkey"
    FOREIGN KEY ("folder_module_id")
    REFERENCES "folders_modules" ("folder_module_id")
    ON DELETE CASCADE
    ON UPDATE CASCADE,
  CONSTRAINT "folders_modules_translations_unique_locale"
    UNIQUE ("folder_module_id", "locale"),
  CONSTRAINT "folders_modules_translations_locale_not_es"
    CHECK ("locale" <> 'es')
);

CREATE INDEX "folders_modules_translations_locale_idx" ON "folders_modules_translations" ("locale");
CREATE INDEX "folders_modules_translations_folder_module_id_idx" ON "folders_modules_translations" ("folder_module_id");
