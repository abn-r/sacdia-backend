-- Permisos de la revisión de constancias de consejería (F6).
--
-- service_credentials:review  -> director-lf, assistant-lf, coordinator,
--   zone-coordinator, general-coordinator, pastor, admin, super-admin. El
--   alcance (campo local, territorio del coordinador, distritos del pastor) lo
--   resuelve el servicio; el permiso solo abre la puerta.
-- role_requirements:manage    -> admin, super-admin.
--
-- assistant-admin no recibe ninguno (el seed también se lo quita).
-- Idempotente: upsert de permisos, ON CONFLICT en los grants.

INSERT INTO permissions (permission_name, description, active) VALUES
  ('service_credentials:review', 'Review counselor credentials of people in own scope (Local Field, coordinators, district pastors)', true),
  ('role_requirements:manage', 'Change the mode, start date and equivalent certification of a club role requirement', true)
ON CONFLICT (permission_name) DO UPDATE SET
  description = EXCLUDED.description,
  active = EXCLUDED.active,
  modified_at = now();

INSERT INTO role_permissions (role_permission_id, role_id, permission_id, active)
SELECT gen_random_uuid(), r.role_id, p.permission_id, true
FROM roles r
CROSS JOIN permissions p
WHERE r.role_name IN (
    'director-lf', 'assistant-lf',
    'coordinator', 'zone-coordinator', 'general-coordinator',
    'pastor',
    'admin', 'super-admin'
  )
  AND r.role_category = 'GLOBAL'
  AND r.active = true
  AND p.active = true
  AND p.permission_name = 'service_credentials:review'
ON CONFLICT (role_id, permission_id) DO UPDATE SET
  active = true,
  modified_at = now();

INSERT INTO role_permissions (role_permission_id, role_id, permission_id, active)
SELECT gen_random_uuid(), r.role_id, p.permission_id, true
FROM roles r
CROSS JOIN permissions p
WHERE r.role_name IN ('admin', 'super-admin')
  AND r.role_category = 'GLOBAL'
  AND r.active = true
  AND p.active = true
  AND p.permission_name = 'role_requirements:manage'
ON CONFLICT (role_id, permission_id) DO UPDATE SET
  active = true,
  modified_at = now();
