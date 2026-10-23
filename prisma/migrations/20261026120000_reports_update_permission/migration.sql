-- Create reports:update and reports:write, two permissions that routes already
-- require but that were never created (DML only).
--
-- Before: PermissionsGuard is fail-closed, so a route guarded by a permission that
-- does not exist answers 403 to every role (admin included):
--   - PATCH admin/{quarterly,annual}-reports/:id, POST :id/regenerate and
--     POST :id/finalize need reports:update: nobody could finalize a quarterly or
--     annual report.
--   - POST monthly-reports/:reportId/regenerate needs reports:write: nobody could
--     re-render the stored PDF of a generated / submitted monthly report.
--
-- 1. Create reports:update (edit manual data, regenerate and finalize quarterly /
--    annual club reports) and reports:write (re-render the stored monthly PDF from
--    its frozen snapshot).
-- 2. reports:update goes to the GLOBAL platform admins (super-admin, admin,
--    assistant-admin) and the territorial roles (assistant/director of local field,
--    union and division): the roles whose report visibility is territorial
--    (src/reports/report-visibility-scope.ts). Every mutation route still checks
--    that visibility first, so each role only acts inside its own territory.
--    Never coordinators, pastor or CLUB roles.
-- 3. reports:write goes to every role and every direct grant that holds an ACTIVE
--    reports:submit today, EXCEPT the GLOBAL coordinator roles. Regenerate does not
--    change data, and sacdia-admin calls it from the same "Generar" action as
--    generate (reports:submit) once a report is generated, so whoever can generate
--    can also re-render. The route keeps its monthly_report resource scope.
--
-- Idempotent: ON CONFLICT DO NOTHING everywhere. Roles that do not exist in a
-- database are skipped. The same rows live in prisma/seeds/permissions.seed.sql and
-- prisma/seeds/role-permissions.seed.sql (admin roles pick both up through their
-- wildcard grants).

INSERT INTO permissions (permission_name, description, active)
VALUES
  ('reports:update', 'Edit, regenerate and finalize quarterly and annual club reports', true),
  ('reports:write', 'Re-render the stored PDF of a generated or submitted monthly report', true)
ON CONFLICT (permission_name) DO NOTHING;

INSERT INTO role_permissions (role_permission_id, role_id, permission_id, active)
SELECT gen_random_uuid(), r.role_id, p.permission_id, true
FROM roles r
CROSS JOIN permissions p
WHERE r.role_name IN (
    'super-admin', 'admin', 'assistant-admin',
    'assistant-lf', 'director-lf',
    'assistant-union', 'director-union',
    'assistant-dia', 'director-dia'
  )
  AND r.role_category = 'GLOBAL'
  AND r.active = true
  AND p.active = true
  AND p.permission_name = 'reports:update'
ON CONFLICT (role_id, permission_id) DO NOTHING;

INSERT INTO role_permissions (role_permission_id, role_id, permission_id, active)
SELECT gen_random_uuid(), rp.role_id, write_perm.permission_id, true
FROM role_permissions rp
JOIN permissions submit_perm
  ON submit_perm.permission_id = rp.permission_id
 AND submit_perm.permission_name = 'reports:submit'
 AND submit_perm.active = true
JOIN roles r ON r.role_id = rp.role_id
CROSS JOIN permissions write_perm
WHERE write_perm.permission_name = 'reports:write'
  AND rp.active = true
  AND r.role_name NOT IN ('coordinator', 'zone-coordinator', 'general-coordinator')
ON CONFLICT (role_id, permission_id) DO NOTHING;

INSERT INTO users_permissions (user_id, permission_id, active)
SELECT up.user_id, write_perm.permission_id, true
FROM users_permissions up
JOIN permissions submit_perm
  ON submit_perm.permission_id = up.permission_id
 AND submit_perm.permission_name = 'reports:submit'
 AND submit_perm.active = true
CROSS JOIN permissions write_perm
WHERE write_perm.permission_name = 'reports:write'
  AND up.active = true
ON CONFLICT (user_id, permission_id) DO NOTHING;
