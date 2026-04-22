-- Migration: add cron_run_log table for persistent @Cron execution metrics.
-- Apply manually via psql:
--   psql $DATABASE_URL -f prisma/migrations/20260422000000_add_cron_run_log/migration.sql

CREATE TABLE "cron_run_log" (
  "run_id"          SERIAL        NOT NULL,
  "job_name"        VARCHAR(100)  NOT NULL,
  "started_at"      TIMESTAMPTZ   NOT NULL,
  "ended_at"        TIMESTAMPTZ,
  "duration_ms"     INTEGER,
  "status"          VARCHAR(20)   NOT NULL
                    CONSTRAINT "cron_run_log_status_check"
                    CHECK (status IN ('running','completed','failed','skipped')),
  "items_processed" INTEGER,
  "error_message"   TEXT,
  "metadata"        JSONB,

  CONSTRAINT "cron_run_log_pkey" PRIMARY KEY ("run_id")
);

CREATE INDEX "idx_cron_run_log_job_started"
  ON "cron_run_log" ("job_name", "started_at" DESC);

CREATE INDEX "idx_cron_run_log_status_started"
  ON "cron_run_log" ("status", "started_at" DESC);
