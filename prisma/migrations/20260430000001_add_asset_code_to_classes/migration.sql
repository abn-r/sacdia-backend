-- Migration: 20260430000001_add_asset_code_to_classes
-- Adds asset_code (VARCHAR(10)) to classes for explicit image mapping
-- in the mobile roadmap, decoupled from positional ordering.
--
-- Backfill is keyed by class_id (verified identical across dev/staging/production).
-- Pattern: AV-01..AV-06 (club_type_id=1), CQ-01..CQ-06 (club_type_id=2), GM-01..GM-03 (club_type_id=3).

BEGIN;

ALTER TABLE classes ADD COLUMN IF NOT EXISTS asset_code VARCHAR(10);

UPDATE classes SET asset_code = 'AV-01' WHERE class_id = 1;
UPDATE classes SET asset_code = 'AV-02' WHERE class_id = 2;
UPDATE classes SET asset_code = 'AV-03' WHERE class_id = 3;
UPDATE classes SET asset_code = 'AV-04' WHERE class_id = 4;
UPDATE classes SET asset_code = 'AV-05' WHERE class_id = 5;
UPDATE classes SET asset_code = 'AV-06' WHERE class_id = 6;
UPDATE classes SET asset_code = 'CQ-01' WHERE class_id = 7;
UPDATE classes SET asset_code = 'CQ-02' WHERE class_id = 8;
UPDATE classes SET asset_code = 'CQ-03' WHERE class_id = 9;
UPDATE classes SET asset_code = 'CQ-04' WHERE class_id = 10;
UPDATE classes SET asset_code = 'CQ-05' WHERE class_id = 11;
UPDATE classes SET asset_code = 'CQ-06' WHERE class_id = 12;
UPDATE classes SET asset_code = 'GM-01' WHERE class_id = 13;
UPDATE classes SET asset_code = 'GM-02' WHERE class_id = 14;
UPDATE classes SET asset_code = 'GM-03' WHERE class_id = 15;

INSERT INTO _prisma_migrations (id, checksum, migration_name, finished_at, applied_steps_count)
SELECT gen_random_uuid(), 'manual', '20260430000001_add_asset_code_to_classes', NOW(), 1
WHERE NOT EXISTS (
  SELECT 1 FROM _prisma_migrations WHERE migration_name = '20260430000001_add_asset_code_to_classes'
);

COMMIT;
