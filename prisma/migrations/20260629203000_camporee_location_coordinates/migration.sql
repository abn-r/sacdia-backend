ALTER TABLE "local_camporees"
  ADD COLUMN IF NOT EXISTS "lat" DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS "long" DOUBLE PRECISION;

ALTER TABLE "union_camporees"
  ADD COLUMN IF NOT EXISTS "lat" DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS "long" DOUBLE PRECISION;

-- Allow club operational roles to read camporee events from the mobile detail.
INSERT INTO "role_permissions" ("role_permission_id", "role_id", "permission_id")
SELECT gen_random_uuid(), r."role_id", p."permission_id"
FROM "roles" r
CROSS JOIN "permissions" p
WHERE r."role_name" IN (
    'director',
    'deputy-director',
    'secretary',
    'secretary-treasurer',
    'treasurer',
    'counselor'
  )
  AND r."role_category" = 'CLUB'
  AND r."active" = TRUE
  AND p."permission_name" = 'camporee_events:read'
  AND p."active" = TRUE
ON CONFLICT ("role_id", "permission_id") DO NOTHING;
