-- Targeted, idempotent extract of the certification-engine permission blocks
-- from prisma/seeds/permissions.seed.sql and role-permissions.seed.sql.
-- Safe to re-run; only touches the 4 certifications:* engine permissions.
BEGIN;

INSERT INTO permissions (permission_name, description, active) VALUES
  ('certifications:configure', 'Create/edit certification definitions, versions, eligibility rules and requirement trees (DRAFT only)', true),
  ('certifications:publish', 'Publish or retire a certification version', true),
  ('certifications:review', 'Review submitted certification requirements/closeouts', true),
  ('certifications:certify', 'Approve final certification review and mark member as certified', true)
ON CONFLICT (permission_name) DO UPDATE SET
  description = EXCLUDED.description,
  active = EXCLUDED.active,
  modified_at = now();

DELETE FROM role_permissions rp
USING permissions p, roles r
WHERE rp.permission_id = p.permission_id
  AND rp.role_id = r.role_id
  AND p.permission_name IN ('certifications:configure', 'certifications:publish')
  AND NOT (
    r.role_name IN ('director-lf', 'assistant-lf', 'admin', 'super-admin')
    AND r.role_category = 'GLOBAL'
  );

INSERT INTO role_permissions (role_permission_id, role_id, permission_id, active)
SELECT gen_random_uuid(), r.role_id, p.permission_id, true
FROM roles r
CROSS JOIN permissions p
WHERE r.role_name IN ('director-lf', 'assistant-lf')
  AND r.role_category = 'GLOBAL'
  AND r.active = true
  AND p.active = true
  AND p.permission_name IN ('certifications:configure', 'certifications:publish')
ON CONFLICT (role_id, permission_id) DO UPDATE SET
  active = true,
  modified_at = now();

DELETE FROM role_permissions rp
USING permissions p, roles r
WHERE rp.permission_id = p.permission_id
  AND rp.role_id = r.role_id
  AND p.permission_name IN ('certifications:review', 'certifications:certify')
  AND NOT (
    r.role_name IN ('director-lf', 'assistant-lf', 'admin', 'super-admin')
    AND r.role_category = 'GLOBAL'
  );

INSERT INTO role_permissions (role_permission_id, role_id, permission_id, active)
SELECT gen_random_uuid(), r.role_id, p.permission_id, true
FROM roles r
CROSS JOIN permissions p
WHERE r.role_name IN ('director-lf', 'assistant-lf', 'admin', 'super-admin')
  AND r.role_category = 'GLOBAL'
  AND r.active = true
  AND p.active = true
  AND p.permission_name IN ('certifications:review', 'certifications:certify')
ON CONFLICT (role_id, permission_id) DO UPDATE SET
  active = true,
  modified_at = now();

COMMIT;
