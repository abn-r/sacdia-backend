-- Translation table for class_sections.
-- Approach X: Spanish (es) stays in main table; this table holds only non-es locales.

CREATE TABLE "class_sections_translations" (
  "id" SERIAL PRIMARY KEY,
  "section_id" INTEGER NOT NULL,
  "locale" VARCHAR(10) NOT NULL,
  "name" VARCHAR(255),
  "description" TEXT,
  "created_at" TIMESTAMPTZ(6) DEFAULT NOW(),
  "updated_at" TIMESTAMPTZ(6) DEFAULT NOW(),
  CONSTRAINT "class_sections_translations_section_id_fkey"
    FOREIGN KEY ("section_id")
    REFERENCES "class_sections" ("section_id")
    ON DELETE CASCADE
    ON UPDATE CASCADE,
  CONSTRAINT "class_sections_translations_unique_locale"
    UNIQUE ("section_id", "locale"),
  CONSTRAINT "class_sections_translations_locale_not_es"
    CHECK ("locale" <> 'es')
);

CREATE INDEX "class_sections_translations_locale_idx" ON "class_sections_translations" ("locale");
CREATE INDEX "class_sections_translations_section_id_idx" ON "class_sections_translations" ("section_id");
