ALTER TABLE "monthly_reports"
  ADD COLUMN "pdf_r2_key" VARCHAR(512),
  ADD COLUMN "pdf_size_bytes" BIGINT,
  ADD COLUMN "pdf_sha256" CHAR(64),
  ADD COLUMN "pdf_generated_at" TIMESTAMPTZ(6),
  ADD COLUMN "pdf_template_version" VARCHAR(32);

CREATE INDEX "idx_monthly_reports_pdf_template_version"
  ON "monthly_reports" ("pdf_template_version");

ALTER TABLE "monthly_reports"
  ADD CONSTRAINT "monthly_reports_pdf_metadata_complete_chk" CHECK (
    ("pdf_r2_key" IS NULL
      AND "pdf_size_bytes" IS NULL
      AND "pdf_sha256" IS NULL
      AND "pdf_generated_at" IS NULL
      AND "pdf_template_version" IS NULL)
    OR
    ("pdf_r2_key" IS NOT NULL
      AND "pdf_size_bytes" IS NOT NULL
      AND "pdf_size_bytes" > 0
      AND "pdf_sha256" IS NOT NULL
      AND "pdf_sha256" ~ '^[0-9a-f]{64}$'
      AND "pdf_generated_at" IS NOT NULL
      AND "pdf_template_version" IS NOT NULL)
  );
