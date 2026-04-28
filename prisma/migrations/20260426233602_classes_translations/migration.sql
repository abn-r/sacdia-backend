-- Translation table for classes.
-- Approach X: Spanish (es) stays in main table; this table holds only non-es locales.

CREATE TABLE "classes_translations" (
  "id" SERIAL PRIMARY KEY,
  "class_id" INTEGER NOT NULL,
  "locale" VARCHAR(10) NOT NULL,
  "name" VARCHAR(255),
  "description" TEXT,
  "created_at" TIMESTAMPTZ(6) DEFAULT NOW(),
  "updated_at" TIMESTAMPTZ(6) DEFAULT NOW(),
  CONSTRAINT "classes_translations_class_id_fkey"
    FOREIGN KEY ("class_id")
    REFERENCES "classes" ("class_id")
    ON DELETE CASCADE
    ON UPDATE CASCADE,
  CONSTRAINT "classes_translations_unique_locale"
    UNIQUE ("class_id", "locale"),
  CONSTRAINT "classes_translations_locale_not_es"
    CHECK ("locale" <> 'es')
);

CREATE INDEX "classes_translations_locale_idx" ON "classes_translations" ("locale");
CREATE INDEX "classes_translations_class_id_idx" ON "classes_translations" ("class_id");
