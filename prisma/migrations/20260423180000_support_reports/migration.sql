-- Migration: 20260423180000_support_reports
-- Adds support_reports table for the Soporte/Ayuda feature (mobile reports).
--
-- Design notes:
--   - id is UUID PK (returned to the mobile client as reportId).
--   - user_id FK with CASCADE: if the user account is deleted their reports go too.
--   - category is a free-form VARCHAR(32) (enum validation lives in the DTO).
--     Expected values: bug | feature_request | account | data_issue | performance | other
--   - title: VARCHAR(120) — UI hard-caps the input.
--   - description: TEXT (soft-capped at 2000 chars by the DTO).
--   - device_info: JSONB, required. Shape: { platform, osVersion, model, appVersion, buildNumber }.
--   - user_context: JSONB, optional. Free-form contextual metadata sent by the app.
--   - status: open | in_progress | resolved | closed. Admin-panel will update this later.
--   - Indexes:
--       (user_id)                            — "my recent reports" view.
--       (status, created_at)                 — triage queue ordered by age.
--
-- Apply manually via psql to all 3 Neon branches:
--   psql $DATABASE_URL -f prisma/migrations/20260423180000_support_reports/migration.sql

CREATE TABLE "support_reports" (
  "id"           UUID         NOT NULL DEFAULT gen_random_uuid(),
  "user_id"      UUID         NOT NULL,
  "category"     VARCHAR(32)  NOT NULL
                 CONSTRAINT "support_reports_category_check"
                 CHECK (category IN ('bug','feature_request','account','data_issue','performance','other')),
  "title"        VARCHAR(120) NOT NULL,
  "description"  TEXT         NOT NULL,
  "device_info"  JSONB        NOT NULL,
  "user_context" JSONB,
  "status"       VARCHAR(16)  NOT NULL DEFAULT 'open'
                 CONSTRAINT "support_reports_status_check"
                 CHECK (status IN ('open','in_progress','resolved','closed')),
  "created_at"   TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  "updated_at"   TIMESTAMPTZ  NOT NULL DEFAULT NOW(),

  CONSTRAINT "support_reports_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "support_reports_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users" ("user_id") ON DELETE CASCADE
);

-- "My recent reports" view (and per-user rate-limit counts).
CREATE INDEX "idx_support_reports_user_id"
  ON "support_reports" ("user_id");

-- Triage queue: open/in_progress items sorted by age.
CREATE INDEX "idx_support_reports_status_created"
  ON "support_reports" ("status", "created_at");

-- Prisma migration tracking — uncomment and run ONCE after applying DDL above.
-- INSERT INTO "_prisma_migrations" (id, checksum, finished_at, migration_name, logs, rolled_back_at, started_at, applied_steps_count)
-- VALUES (gen_random_uuid()::text, '', now(), '20260423180000_support_reports', NULL, NULL, now(), 1);
