-- Seed the Phase 3c family permissions (DML only; precedent 20260823190000_seed_audit_read_permission).
--   dependents:create  register a minor in a club section under club custody
--                      CLUB director, deputy-director
--   consent:verify     verify a minor's signed consent form WITHOUT approving the membership
--                      CLUB director, deputy-director, secretary, secretary-treasurer
-- admin, assistant-admin and super-admin receive both because their seed blocks are wildcards
-- (everything except :delete / audit:read / permissions:assign); a migration cannot rely on a re-seed.
-- GLOBAL coordinator, zone-coordinator and general-coordinator are NOT granted consent:verify: the
-- PermissionsGuard cannot resolve their territory for club_assignment resources (see
-- src/auth/permissions-consent-verify.spec.ts), so the grant would be denied everywhere.
-- Idempotent: every INSERT carries ON CONFLICT, so applying it twice changes nothing.
-- The same rows live in prisma/seeds/permissions.seed.sql and prisma/seeds/role-permissions.seed.sql.
INSERT INTO permissions (permission_name, description, active)
VALUES
  ('dependents:create', 'Register a minor in a club section under club custody', true),
  ('consent:verify', 'Verify the signed consent form of a minor without approving membership', true)
ON CONFLICT (permission_name) DO UPDATE SET
  description = EXCLUDED.description,
  active = EXCLUDED.active,
  modified_at = now();

INSERT INTO role_permissions (role_permission_id, role_id, permission_id)
SELECT gen_random_uuid(), r.role_id, p.permission_id
FROM roles r
CROSS JOIN permissions p
WHERE r.role_name IN ('director', 'deputy-director')
  AND r.role_category = 'CLUB'
  AND r.active = true
  AND p.active = true
  AND p.permission_name = 'dependents:create'
ON CONFLICT (role_id, permission_id) DO NOTHING;

INSERT INTO role_permissions (role_permission_id, role_id, permission_id)
SELECT gen_random_uuid(), r.role_id, p.permission_id
FROM roles r
CROSS JOIN permissions p
WHERE r.role_name IN ('director', 'deputy-director', 'secretary', 'secretary-treasurer')
  AND r.role_category = 'CLUB'
  AND r.active = true
  AND p.active = true
  AND p.permission_name = 'consent:verify'
ON CONFLICT (role_id, permission_id) DO NOTHING;

INSERT INTO role_permissions (role_permission_id, role_id, permission_id)
SELECT gen_random_uuid(), r.role_id, p.permission_id
FROM roles r
CROSS JOIN permissions p
WHERE r.role_name IN ('admin', 'assistant-admin', 'super-admin')
  AND r.role_category = 'GLOBAL'
  AND r.active = true
  AND p.active = true
  AND p.permission_name IN ('dependents:create', 'consent:verify')
ON CONFLICT (role_id, permission_id) DO NOTHING;
