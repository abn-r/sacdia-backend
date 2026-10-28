-- Zone and general coordinators read the shared resource library, like coordinators.
--
-- resources:read + resource_categories:read were granted only to the GLOBAL
-- `coordinator` role. zone-coordinator and general-coordinator oversee
-- coordinators and hold every other coordinator permission, so they were the
-- only coordinator roles without the read-only library.
--
-- Idempotent: ON CONFLICT DO NOTHING. The same rows live in
-- prisma/seeds/role-permissions.seed.sql.

INSERT INTO role_permissions (role_permission_id, role_id, permission_id)
SELECT gen_random_uuid(), r.role_id, p.permission_id
FROM roles r
CROSS JOIN permissions p
WHERE r.role_name IN ('zone-coordinator', 'general-coordinator')
  AND r.role_category = 'GLOBAL'
  AND r.active = true
  AND p.active = true
  AND p.permission_name IN ('resources:read', 'resource_categories:read')
ON CONFLICT (role_id, permission_id) DO NOTHING;
