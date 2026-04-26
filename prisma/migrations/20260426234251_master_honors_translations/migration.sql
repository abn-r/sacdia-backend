-- Translation table for master_honors.
-- Approach X: Spanish (es) stays in main table; this table holds only non-es locales.

CREATE TABLE "master_honors_translations" (
  "id" SERIAL PRIMARY KEY,
  "master_honor_id" INTEGER NOT NULL,
  "locale" VARCHAR(10) NOT NULL,
  "name" VARCHAR(100),
  "created_at" TIMESTAMPTZ(6) DEFAULT NOW(),
  "updated_at" TIMESTAMPTZ(6) DEFAULT NOW(),
  CONSTRAINT "master_honors_translations_master_honor_id_fkey"
    FOREIGN KEY ("master_honor_id")
    REFERENCES "master_honors" ("master_honor_id")
    ON DELETE CASCADE
    ON UPDATE CASCADE,
  CONSTRAINT "master_honors_translations_unique_locale"
    UNIQUE ("master_honor_id", "locale"),
  CONSTRAINT "master_honors_translations_locale_not_es"
    CHECK ("locale" <> 'es')
);

CREATE INDEX "master_honors_translations_locale_idx" ON "master_honors_translations" ("locale");
CREATE INDEX "master_honors_translations_master_honor_id_idx" ON "master_honors_translations" ("master_honor_id");
