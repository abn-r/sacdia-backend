-- Migration: 20260417200000_data_export_requests
-- Adds data_export_requests table for GDPR "Download My Data" feature.
--
-- Design notes:
--   - export_id is UUID PK (not serial) — returned directly to mobile client.
--   - user_id FK with CASCADE: if user is deleted, their export rows go too.
--   - r2_key and sha256_checksum populated when status transitions to 'ready'.
--   - expires_at is set to now() + 48h on completion; cleanup cron marks 'expired'
--     and deletes the R2 object when this timestamp passes.
--   - downloaded_count + last_downloaded_at: used by audit log endpoint.
--   - Partial index on (status, expires_at) WHERE status IN ('ready','failed')
--     optimises the nightly cleanup cron query.
--
-- Apply manually via psql to all 3 Neon branches:
--   psql $DATABASE_URL -f prisma/migrations/20260417200000_data_export_requests/migration.sql

CREATE TABLE "data_export_requests" (
  "export_id"          UUID          NOT NULL DEFAULT gen_random_uuid(),
  "user_id"            UUID          NOT NULL,
  "status"             VARCHAR(16)   NOT NULL DEFAULT 'pending'
                       CONSTRAINT "data_export_requests_status_check"
                       CHECK (status IN ('pending','processing','ready','failed','expired')),
  "format"             VARCHAR(16)   NOT NULL DEFAULT 'json',
  "r2_key"             VARCHAR(512),
  "file_size_bytes"    BIGINT,
  "sha256_checksum"    VARCHAR(64),
  "failure_reason"     TEXT,
  "created_at"         TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  "started_at"         TIMESTAMPTZ,
  "completed_at"       TIMESTAMPTZ,
  "expires_at"         TIMESTAMPTZ,
  "downloaded_count"   INTEGER       NOT NULL DEFAULT 0,
  "last_downloaded_at" TIMESTAMPTZ,

  CONSTRAINT "data_export_requests_pkey" PRIMARY KEY ("export_id"),
  CONSTRAINT "data_export_requests_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users" ("user_id") ON DELETE CASCADE
);

-- Primary query path: list exports for a user ordered by creation date
CREATE INDEX "idx_data_export_requests_user_created"
  ON "data_export_requests" ("user_id", "created_at" DESC);

-- Cleanup cron: find rows where ready/failed exports have expired
CREATE INDEX "idx_data_export_requests_cleanup"
  ON "data_export_requests" ("status", "expires_at")
  WHERE status IN ('ready', 'failed');

-- Prisma migration tracking — uncomment and run ONCE after applying DDL above.
-- INSERT INTO "_prisma_migrations" (id, checksum, finished_at, migration_name, logs, rolled_back_at, started_at, applied_steps_count)
-- VALUES (gen_random_uuid()::text, '', now(), '20260417200000_data_export_requests', NULL, NULL, now(), 1);
