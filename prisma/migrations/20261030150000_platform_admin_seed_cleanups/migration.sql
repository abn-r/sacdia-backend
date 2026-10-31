-- Keep the role-permissions seed cleanups after 20261030140000.
--
-- 20261030140000 re-applied the super-admin / admin / assistant-admin
-- wildcard rules but not the cleanups the seed runs after them, so it also
-- granted permissions the seed reserves for other roles:
--   camporees:register                 territorial camporee organizers
--   camporees:register_active_section  club director
--   camporee-orders:create, :upload-proof, :distribute,
--   camporee-supplies:plan             club roles
-- Remove those from the three platform-admin roles.
--
-- insurance:configure stays for super-admin and admin (decision of
-- 2026-10-30: platform admins configure insurance for a local field) and is
-- removed from assistant-admin, matching the seed cleanup.
--
-- Idempotent: deleting rows that are already gone is a no-op.

DELETE FROM role_permissions rp
USING roles r, permissions p
WHERE rp.role_id = r.role_id
  AND rp.permission_id = p.permission_id
  AND r.role_name IN ('super-admin', 'admin', 'assistant-admin')
  AND r.role_category = 'GLOBAL'
  AND p.permission_name IN (
    'camporees:register',
    'camporees:register_active_section',
    'camporee-orders:create',
    'camporee-orders:upload-proof',
    'camporee-orders:distribute',
    'camporee-supplies:plan'
  );

DELETE FROM role_permissions rp
USING roles r, permissions p
WHERE rp.role_id = r.role_id
  AND rp.permission_id = p.permission_id
  AND r.role_name = 'assistant-admin'
  AND r.role_category = 'GLOBAL'
  AND p.permission_name = 'insurance:configure';
