-- Permission grants decided in the 2026-10-30 role QA.
--
-- 1. super-admin, admin and assistant-admin follow a rule in the
--    role-permissions seed (super-admin: every active permission; admin:
--    every non-delete permission but audit:read; assistant-admin: the same
--    minus permissions:assign). Permissions created later by migrations
--    were granted only to the roles those migrations named, so databases
--    drifted: super-admin and admin lacked insurance:configure and
--    camporees:register, among others. Re-apply the seed rules.
-- 2. admin also gets every :delete permission a territorial role
--    (local field, union, division) holds: it administers the same data.
-- 3. Union leadership configures its union camporees: events, venues,
--    judges, staff and templates (camporee_events:*), reading the event
--    type catalog to do it.
--
-- Idempotent: ON CONFLICT DO NOTHING.

INSERT INTO role_permissions (role_permission_id, role_id, permission_id)
SELECT gen_random_uuid(), r.role_id, p.permission_id
FROM roles r
CROSS JOIN permissions p
WHERE r.role_name = 'super-admin'
  AND r.role_category = 'GLOBAL'
  AND r.active = true
  AND p.active = true
ON CONFLICT (role_id, permission_id) DO NOTHING;

INSERT INTO role_permissions (role_permission_id, role_id, permission_id)
SELECT gen_random_uuid(), r.role_id, p.permission_id
FROM roles r
CROSS JOIN permissions p
WHERE r.role_name = 'admin'
  AND r.role_category = 'GLOBAL'
  AND r.active = true
  AND p.active = true
  AND p.permission_name NOT LIKE '%:delete'
  AND p.permission_name <> 'audit:read'
ON CONFLICT (role_id, permission_id) DO NOTHING;

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

INSERT INTO role_permissions (role_permission_id, role_id, permission_id)
SELECT gen_random_uuid(), admin.role_id, p.permission_id
FROM roles admin
CROSS JOIN permissions p
WHERE admin.role_name = 'admin'
  AND admin.role_category = 'GLOBAL'
  AND admin.active = true
  AND p.active = true
  AND p.permission_name LIKE '%:delete'
  AND EXISTS (
    SELECT 1
    FROM role_permissions rp
    JOIN roles territorial ON territorial.role_id = rp.role_id
    WHERE rp.permission_id = p.permission_id
      AND territorial.role_category = 'GLOBAL'
      AND territorial.role_name IN (
        'director-lf', 'assistant-lf',
        'director-union', 'assistant-union',
        'director-dia', 'assistant-dia'
      )
  )
ON CONFLICT (role_id, permission_id) DO NOTHING;

INSERT INTO role_permissions (role_permission_id, role_id, permission_id)
SELECT gen_random_uuid(), r.role_id, p.permission_id
FROM roles r
CROSS JOIN permissions p
WHERE r.role_name IN ('director-union', 'assistant-union')
  AND r.role_category = 'GLOBAL'
  AND r.active = true
  AND p.active = true
  AND p.permission_name IN (
    'camporee_events:create',
    'camporee_events:read',
    'camporee_events:update',
    'camporee_events:delete',
    'camporee_event_types:read'
  )
ON CONFLICT (role_id, permission_id) DO NOTHING;
