-- Migration: 20260423155416_notification_deliveries_unread_index
-- Adds a partial index on notification_deliveries(user_id, created_at DESC) WHERE read_at IS NULL.
--
-- Rationale: the most common inbox query filters deliveries by user_id where read_at IS NULL
-- (unread notifications). A partial index covering only unread rows dramatically reduces
-- index size and improves scan performance as delivered notifications accumulate over time.
--
-- CONCURRENTLY cannot run inside a transaction — DDL and _prisma_migrations INSERT
-- are separated below.
--
-- Apply manually via psql (outside any explicit transaction block):
--   psql $DATABASE_URL -f prisma/migrations/20260423155416_notification_deliveries_unread_index/migration.sql
--
-- Note: IF NOT EXISTS is used for idempotency — safe to re-run.

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_notification_deliveries_user_unread
  ON notification_deliveries (user_id, created_at DESC)
  WHERE read_at IS NULL;

-- Register migration in Prisma tracking table (separate statement — not in same txn as CONCURRENTLY).
INSERT INTO "_prisma_migrations" (id, checksum, finished_at, migration_name, logs, rolled_back_at, started_at, applied_steps_count)
VALUES (
  gen_random_uuid()::text,
  sha256(pg_read_file('prisma/migrations/20260423155416_notification_deliveries_unread_index/migration.sql')::bytea)::text,
  now(),
  '20260423155416_notification_deliveries_unread_index',
  NULL,
  NULL,
  now(),
  1
)
ON CONFLICT (migration_name) DO NOTHING;
