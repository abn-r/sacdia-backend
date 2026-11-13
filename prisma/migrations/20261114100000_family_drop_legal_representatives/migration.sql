-- Family profiles Phase 4c-2: drop the legacy legal_representatives table.
--
-- IRREVERSIBLE. Guardianships (Phase 2) superseded this table and the code that
-- used it was removed in Phase 4c-1. Do NOT apply until 4c-1 is deployed on the
-- target environment (an old instance would query a dropped table).
--
-- REQUIRED before applying, in EACH environment (dev, staging, prod), from the
-- matching Neon branch, stored outside the repository:
--   pg_dump "$DATABASE_URL" -t legal_representatives --data-only --inserts \
--     -f legal_representatives_<env>_<date>.sql
--   (include the schema too, drop --data-only, if the table definition must be
--   restorable)
-- Rollback = restore that dump. No data is migrated into guardianships.
--
-- Dropping the table also drops its indexes (idx_legal_reps_user,
-- idx_legal_reps_representative) and its foreign keys to users and
-- relationship_types. IF EXISTS keeps the file re-runnable.

DROP TABLE IF EXISTS legal_representatives;
