-- Coordinators (and zone/general) may mark enrollments as invested.
-- Permission already exists; grant it to the coordinator trio.

INSERT INTO role_permissions (role_permission_id, role_id, permission_id, active)
SELECT gen_random_uuid(), r.role_id, p.permission_id, true
FROM roles r
JOIN permissions p ON p.permission_name = 'investiture:mark_invested'
WHERE r.role_name IN (
    'coordinator',
    'zone-coordinator',
    'general-coordinator'
  )
  AND r.role_category = 'GLOBAL'
  AND r.active = true
  AND p.active = true
ON CONFLICT (role_id, permission_id) DO NOTHING;
