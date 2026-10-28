-- Ensure the GLOBAL assistant-admin role exists, with its seed permissions.
--
-- The code references assistant-admin (GlobalRolesGuard, ADMIN_SCOPE_ROLES,
-- screen catalogs), but roles are only created by prisma/seed.ts, so a database
-- built from migrations (or seeded before the role existed) lacks it. The dev
-- branch was such a database.
--
-- Permissions mirror the ASSISTANT-ADMIN block of
-- prisma/seeds/role-permissions.seed.sql: every active permission except
-- *:delete, audit:read and permissions:assign. Rows are only added, never
-- removed, so an existing assistant-admin keeps any grant it already has.
--
-- Idempotent: ON CONFLICT DO NOTHING everywhere.

INSERT INTO roles (role_name, role_category, description, active)
VALUES (
  'assistant-admin',
  'GLOBAL',
  'Assistant administrator who supports platform management tasks with limited administrative privileges.',
  true
)
ON CONFLICT (role_name) DO NOTHING;

INSERT INTO role_permissions (role_permission_id, role_id, permission_id)
SELECT gen_random_uuid(), r.role_id, p.permission_id
FROM roles r
CROSS JOIN permissions p
WHERE r.role_name = 'assistant-admin'
  AND r.role_category = 'GLOBAL'
  AND r.active = true
  AND p.active = true
  AND p.permission_name NOT LIKE '%:delete'
  AND p.permission_name <> 'audit:read'
  AND p.permission_name <> 'permissions:assign'
ON CONFLICT (role_id, permission_id) DO NOTHING;
