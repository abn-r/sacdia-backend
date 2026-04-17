-- Migration: 20260417100000_account_deletion_log
-- Adds account_deletion_log table for audit trail of self-service account deletions.
-- Required by Apple App Store guideline 5.1.1(v) and GDPR audit requirements.
--
-- Design note: user_id is stored as UUID without a FK constraint.
-- The users row will be soft-deleted/PII-anonymized during the deletion flow —
-- a FK with ON DELETE CASCADE would destroy the audit record, defeating its purpose.
-- A FK with ON DELETE RESTRICT would block the users.active update (soft-delete).
-- Plain UUID column is intentional.
--
-- Apply manually via psql:
--   psql $DATABASE_URL -f prisma/migrations/20260417100000_account_deletion_log/migration.sql

CREATE TABLE "account_deletion_log" (
  "deletion_id"  UUID          NOT NULL DEFAULT gen_random_uuid(),
  "user_id"      UUID          NOT NULL,
  "requested_at" TIMESTAMPTZ   NOT NULL,
  "completed_at" TIMESTAMPTZ,
  "ip_address"   VARCHAR(45),
  "created_at"   TIMESTAMPTZ   NOT NULL DEFAULT now(),

  CONSTRAINT "account_deletion_log_pkey" PRIMARY KEY ("deletion_id")
);

CREATE INDEX "idx_account_deletion_log_user_id"
  ON "account_deletion_log" ("user_id");

CREATE INDEX "idx_account_deletion_log_created_at"
  ON "account_deletion_log" ("created_at");

-- Prisma migration tracking: insert record so prisma migrate status is aware.
-- Run this only once after applying the DDL above.
-- INSERT INTO "_prisma_migrations" (id, checksum, finished_at, migration_name, logs, rolled_back_at, started_at, applied_steps_count)
-- VALUES (gen_random_uuid()::text, '', now(), '20260417100000_account_deletion_log', NULL, NULL, now(), 1);
