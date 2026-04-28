-- Translation table for folders.
-- Approach X: Spanish (es) stays in main table; this table holds only non-es locales.

CREATE TABLE "folders_translations" (
  "id" SERIAL PRIMARY KEY,
  "folder_id" INTEGER NOT NULL,
  "locale" VARCHAR(10) NOT NULL,
  "name" VARCHAR(255),
  "description" TEXT,
  "created_at" TIMESTAMPTZ(6) DEFAULT NOW(),
  "updated_at" TIMESTAMPTZ(6) DEFAULT NOW(),
  CONSTRAINT "folders_translations_folder_id_fkey"
    FOREIGN KEY ("folder_id")
    REFERENCES "folders" ("folder_id")
    ON DELETE CASCADE
    ON UPDATE CASCADE,
  CONSTRAINT "folders_translations_unique_locale"
    UNIQUE ("folder_id", "locale"),
  CONSTRAINT "folders_translations_locale_not_es"
    CHECK ("locale" <> 'es')
);

CREATE INDEX "folders_translations_locale_idx" ON "folders_translations" ("locale");
CREATE INDEX "folders_translations_folder_id_idx" ON "folders_translations" ("folder_id");
