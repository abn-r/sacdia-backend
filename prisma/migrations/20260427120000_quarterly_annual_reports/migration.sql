-- Migration: quarterly_annual_reports
-- Created: 2026-04-27
-- Description: Add quarterly_reports and annual_reports tables (line 3.3 reportes-expansion.md)
-- NOTE: Apply manually via psql — Neon shadow DB is disabled.

-- =============================================
-- TABLE: quarterly_reports
-- =============================================

CREATE TABLE IF NOT EXISTS "quarterly_reports" (
  "quarterly_report_id" SERIAL PRIMARY KEY,
  "club_id"             INTEGER NOT NULL,
  "year"                INTEGER NOT NULL,
  "quarter"             INTEGER NOT NULL CHECK ("quarter" BETWEEN 1 AND 4),
  "status"              VARCHAR(20) NOT NULL DEFAULT 'draft',
  "auto_generated_at"   TIMESTAMPTZ(6),
  "finalized_at"        TIMESTAMPTZ(6),
  "finalized_by"        UUID,
  "manual_data"         JSONB,
  "computed_data"       JSONB,
  "pdf_url"             TEXT,
  "created_at"          TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
  "modified_at"         TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),

  CONSTRAINT "fk_quarterly_reports_club"
    FOREIGN KEY ("club_id") REFERENCES "clubs"("club_id")
    ON DELETE NO ACTION ON UPDATE NO ACTION,

  CONSTRAINT "fk_quarterly_reports_finalized_by"
    FOREIGN KEY ("finalized_by") REFERENCES "users"("user_id")
    ON DELETE NO ACTION ON UPDATE NO ACTION
);

CREATE UNIQUE INDEX "quarterly_reports_club_id_year_quarter_key"
  ON "quarterly_reports"("club_id", "year", "quarter");

CREATE INDEX "idx_quarterly_reports_year_quarter"
  ON "quarterly_reports"("year", "quarter");

CREATE INDEX "idx_quarterly_reports_status"
  ON "quarterly_reports"("status");

-- =============================================
-- TABLE: annual_reports
-- =============================================

CREATE TABLE IF NOT EXISTS "annual_reports" (
  "annual_report_id"       SERIAL PRIMARY KEY,
  "club_id"                INTEGER NOT NULL,
  "ecclesiastical_year_id" INTEGER NOT NULL,
  "status"                 VARCHAR(20) NOT NULL DEFAULT 'draft',
  "auto_generated_at"      TIMESTAMPTZ(6),
  "finalized_at"           TIMESTAMPTZ(6),
  "finalized_by"           UUID,
  "manual_data"            JSONB,
  "computed_data"          JSONB,
  "pdf_url"                TEXT,
  "created_at"             TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
  "modified_at"            TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),

  CONSTRAINT "fk_annual_reports_club"
    FOREIGN KEY ("club_id") REFERENCES "clubs"("club_id")
    ON DELETE NO ACTION ON UPDATE NO ACTION,

  CONSTRAINT "fk_annual_reports_ecclesiastical_year"
    FOREIGN KEY ("ecclesiastical_year_id") REFERENCES "ecclesiastical_years"("year_id")
    ON DELETE NO ACTION ON UPDATE NO ACTION,

  CONSTRAINT "fk_annual_reports_finalized_by"
    FOREIGN KEY ("finalized_by") REFERENCES "users"("user_id")
    ON DELETE NO ACTION ON UPDATE NO ACTION
);

CREATE UNIQUE INDEX "annual_reports_club_id_ecclesiastical_year_id_key"
  ON "annual_reports"("club_id", "ecclesiastical_year_id");

CREATE INDEX "idx_annual_reports_status"
  ON "annual_reports"("status");

-- =============================================
-- SYSTEM CONFIG: feature flags (dark launch)
-- =============================================

INSERT INTO "system_config" ("config_key", "config_value", "description", "config_type")
VALUES
  ('reports.quarterly_auto_generate_enabled', 'false', 'Enable quarterly reports auto-generation cron job', 'boolean'),
  ('reports.annual_auto_generate_enabled',    'false', 'Enable annual reports auto-generation cron job',    'boolean')
ON CONFLICT ("config_key") DO NOTHING;
