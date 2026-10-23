-- Coordinators read club reports; monthly-report mutations get their own permission (DML only).
--
-- Before: POST monthly-reports/:enrollmentId (draft), PATCH :reportId/manual-data,
-- POST :reportId/generate and POST :reportId/submit were guarded by reports:read, so granting
-- reports:read to anyone also let them draft, edit, generate and submit monthly reports.
--
-- 1. Create reports:submit (draft / edit / generate / submit monthly reports).
-- 2. Give reports:submit to every role and every direct grant that holds an ACTIVE reports:read
--    today, EXCEPT the GLOBAL coordinator roles: nobody who could submit before loses it.
-- 3. Give reports:read + reports:download (never reports:submit) to the GLOBAL coordinator,
--    zone-coordinator and general-coordinator roles. Their scope is coordinator_assignments:
--    the monthly detail/PDF routes opt in with coordinatorSections, and the admin lists,
--    quarterly/annual detail/PDF and GET /reports/compliance filter by the same visibility.
--
-- Step 2 runs before step 3 so coordinators never hold reports:read when it is copied.
-- Idempotent: ON CONFLICT DO NOTHING everywhere. The same rows live in
-- prisma/seeds/permissions.seed.sql and prisma/seeds/role-permissions.seed.sql.

INSERT INTO permissions (permission_name, description, active)
VALUES ('reports:submit', 'Draft, edit, generate and submit monthly reports', true)
ON CONFLICT (permission_name) DO NOTHING;

INSERT INTO role_permissions (role_permission_id, role_id, permission_id, active)
SELECT gen_random_uuid(), rp.role_id, submit_perm.permission_id, true
FROM role_permissions rp
JOIN permissions read_perm
  ON read_perm.permission_id = rp.permission_id
 AND read_perm.permission_name = 'reports:read'
 AND read_perm.active = true
JOIN roles r ON r.role_id = rp.role_id
CROSS JOIN permissions submit_perm
WHERE submit_perm.permission_name = 'reports:submit'
  AND rp.active = true
  AND r.role_name NOT IN ('coordinator', 'zone-coordinator', 'general-coordinator')
ON CONFLICT (role_id, permission_id) DO NOTHING;

INSERT INTO users_permissions (user_id, permission_id, active)
SELECT up.user_id, submit_perm.permission_id, true
FROM users_permissions up
JOIN permissions read_perm
  ON read_perm.permission_id = up.permission_id
 AND read_perm.permission_name = 'reports:read'
 AND read_perm.active = true
CROSS JOIN permissions submit_perm
WHERE submit_perm.permission_name = 'reports:submit'
  AND up.active = true
ON CONFLICT (user_id, permission_id) DO NOTHING;

INSERT INTO role_permissions (role_permission_id, role_id, permission_id, active)
SELECT gen_random_uuid(), r.role_id, p.permission_id, true
FROM roles r
CROSS JOIN permissions p
WHERE r.role_name IN ('coordinator', 'zone-coordinator', 'general-coordinator')
  AND r.role_category = 'GLOBAL'
  AND r.active = true
  AND p.active = true
  AND p.permission_name IN ('reports:read', 'reports:download')
ON CONFLICT (role_id, permission_id) DO NOTHING;
