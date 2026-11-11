-- Permiso de la validación de inscripciones anuales (club_enrollments).
--
-- club_enrollments:validate -> admin, assistant-admin, super-admin, director-lf,
--   assistant-lf, director-union, assistant-union, director-dia, assistant-dia,
--   coordinator, zone-coordinator, general-coordinator, pastor. El alcance
--   (campo local, unión, división, territorio del coordinador, distritos del
--   pastor) lo resuelve el servicio; el permiso solo abre la puerta.
-- Idempotente: upsert del permiso, ON CONFLICT en los grants.

INSERT INTO permissions (permission_name, description, active) VALUES
  ('club_enrollments:validate', 'Approve or reject the annual enrollment of club sections inside own scope (Local Field, Union, Division, coordinators, district pastors, admins)', true)
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
    'director-union', 'assistant-union',
    'director-dia', 'assistant-dia',
    'coordinator', 'zone-coordinator', 'general-coordinator',
    'pastor',
    'admin', 'assistant-admin', 'super-admin'
  )
  AND r.role_category = 'GLOBAL'
  AND r.active = true
  AND p.active = true
  AND p.permission_name = 'club_enrollments:validate'
ON CONFLICT (role_id, permission_id) DO UPDATE SET
  active = true,
  modified_at = now();
