-- Migration: 20260417183839_user_fcm_tokens_partial_index
-- Adds a partial index on user_fcm_tokens(user_id) WHERE active = true.
--
-- Rationale: all notification fan-out queries (sendToClubMembers, broadcast,
-- sendToSectionRole, sendToGlobalRole) filter tokens with:
--   WHERE user_id IN (...) AND active = true
-- A partial index covering only active=true rows dramatically reduces the
-- index size and improves scan performance when most tokens are inactive over time.
--
-- CONCURRENTLY cannot run inside a transaction — DDL and _prisma_migrations
-- INSERT are separated below.
--
-- Apply manually via psql:
--   psql $DATABASE_URL -f prisma/migrations/20260417183839_user_fcm_tokens_partial_index/migration.sql
--
-- Note: IF NOT EXISTS is used for idempotency — safe to re-run.

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_user_fcm_tokens_user_active
  ON user_fcm_tokens (user_id)
  WHERE active = true;

-- Register migration in Prisma tracking table (separate statement — not in same txn as CONCURRENTLY).
INSERT INTO "_prisma_migrations" (id, checksum, finished_at, migration_name, logs, rolled_back_at, started_at, applied_steps_count)
VALUES (
  gen_random_uuid()::text,
  'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2',
  now(),
  '20260417183839_user_fcm_tokens_partial_index',
  NULL,
  NULL,
  now(),
  1
);
