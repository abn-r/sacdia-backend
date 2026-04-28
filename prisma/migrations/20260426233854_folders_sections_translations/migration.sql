-- Translation table for folders_sections.
-- Approach X: Spanish (es) stays in main table; this table holds only non-es locales.

CREATE TABLE "folders_sections_translations" (
  "id" SERIAL PRIMARY KEY,
  "folder_section_id" INTEGER NOT NULL,
  "locale" VARCHAR(10) NOT NULL,
  "name" VARCHAR(255),
  "description" TEXT,
  "created_at" TIMESTAMPTZ(6) DEFAULT NOW(),
  "updated_at" TIMESTAMPTZ(6) DEFAULT NOW(),
  CONSTRAINT "folders_sections_translations_folder_section_id_fkey"
    FOREIGN KEY ("folder_section_id")
    REFERENCES "folders_sections" ("folder_section_id")
    ON DELETE CASCADE
    ON UPDATE CASCADE,
  CONSTRAINT "folders_sections_translations_unique_locale"
    UNIQUE ("folder_section_id", "locale"),
  CONSTRAINT "folders_sections_translations_locale_not_es"
    CHECK ("locale" <> 'es')
);

CREATE INDEX "folders_sections_translations_locale_idx" ON "folders_sections_translations" ("locale");
CREATE INDEX "folders_sections_translations_folder_section_id_idx" ON "folders_sections_translations" ("folder_section_id");
