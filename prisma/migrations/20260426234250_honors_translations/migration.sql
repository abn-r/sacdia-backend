-- Translation table for honors.
-- Approach X: Spanish (es) stays in main table; this table holds only non-es locales.

CREATE TABLE "honors_translations" (
  "id" SERIAL PRIMARY KEY,
  "honor_id" INTEGER NOT NULL,
  "locale" VARCHAR(10) NOT NULL,
  "name" VARCHAR(100),
  "description" TEXT,
  "created_at" TIMESTAMPTZ(6) DEFAULT NOW(),
  "updated_at" TIMESTAMPTZ(6) DEFAULT NOW(),
  CONSTRAINT "honors_translations_honor_id_fkey"
    FOREIGN KEY ("honor_id")
    REFERENCES "honors" ("honor_id")
    ON DELETE CASCADE
    ON UPDATE CASCADE,
  CONSTRAINT "honors_translations_unique_locale"
    UNIQUE ("honor_id", "locale"),
  CONSTRAINT "honors_translations_locale_not_es"
    CHECK ("locale" <> 'es')
);

CREATE INDEX "honors_translations_locale_idx" ON "honors_translations" ("locale");
CREATE INDEX "honors_translations_honor_id_idx" ON "honors_translations" ("honor_id");
