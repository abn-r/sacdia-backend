-- Seed audit:read for the global audit viewer.
-- Grant only to super-admin. admin's wildcard would otherwise pick it up
-- on the next role-permissions seed; that seed now excludes audit:read.

INSERT INTO permissions (permission_name, description, active)
VALUES
  ('audit:read', 'Read the global audit log viewer (super-admin only)', true)
ON CONFLICT (permission_name) DO UPDATE SET
  description = EXCLUDED.description,
  active = EXCLUDED.active,
  modified_at = now();

INSERT INTO role_permissions (role_permission_id, role_id, permission_id)
SELECT gen_random_uuid(), r.role_id, p.permission_id
FROM roles r
JOIN permissions p ON p.permission_name = 'audit:read'
WHERE r.role_name = 'super-admin'
  AND r.role_category = 'GLOBAL'
  AND r.active = true
  AND p.active = true
ON CONFLICT (role_id, permission_id) DO NOTHING;

DELETE FROM role_permissions rp
USING permissions p, roles r
WHERE rp.permission_id = p.permission_id
  AND rp.role_id = r.role_id
  AND p.permission_name = 'audit:read'
  AND NOT (r.role_name = 'super-admin' AND r.role_category = 'GLOBAL');
