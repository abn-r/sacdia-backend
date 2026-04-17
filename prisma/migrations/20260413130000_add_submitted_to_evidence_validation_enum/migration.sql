-- Add SUBMITTED value to evidence_validation_enum
-- ALTER TYPE ... ADD VALUE cannot run inside a transaction block that also uses
-- the new value in the same transaction. Run standalone (no explicit BEGIN/COMMIT).

ALTER TYPE "evidence_validation_enum" ADD VALUE IF NOT EXISTS 'SUBMITTED';

-- Register migration in Prisma migrations table
-- _prisma_migrations has no unique constraint on migration_name (PK is id),
-- so use INSERT ... WHERE NOT EXISTS to avoid duplicates on re-runs.
INSERT INTO "_prisma_migrations" (
  id,
  checksum,
  finished_at,
  migration_name,
  logs,
  rolled_back_at,
  started_at,
  applied_steps_count
)
SELECT
  gen_random_uuid(),
  'manual',
  NOW(),
  '20260413130000_add_submitted_to_evidence_validation_enum',
  NULL,
  NULL,
  NOW(),
  1
WHERE NOT EXISTS (
  SELECT 1 FROM "_prisma_migrations"
  WHERE migration_name = '20260413130000_add_submitted_to_evidence_validation_enum'
);
