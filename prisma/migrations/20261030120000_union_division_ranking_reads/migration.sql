-- Union and division tiers for member and section ranking reads.
--
-- 20261028130200_revoke_union_global_ranking_reads took read_global away from
-- union leadership because read_global means "no restriction". Division
-- leadership lost it too when the role-permissions seed reinserted its rows.
-- These tiers let them read the rankings of their own territory only:
--   read_union    → clubs whose local field belongs to the caller's union
--   read_division → clubs whose union belongs to the caller's division
-- The services read the union / division id from the global role scope.
--
-- Idempotent: ON CONFLICT DO NOTHING.

INSERT INTO permissions (permission_id, permission_name, description) VALUES
  (gen_random_uuid(), 'member_rankings:read_union',     'Read union member rankings'),
  (gen_random_uuid(), 'member_rankings:read_division',  'Read division member rankings'),
  (gen_random_uuid(), 'section_rankings:read_union',    'Read union section rankings'),
  (gen_random_uuid(), 'section_rankings:read_division', 'Read division section rankings')
ON CONFLICT (permission_name) DO NOTHING;

INSERT INTO role_permissions (role_permission_id, role_id, permission_id)
SELECT gen_random_uuid(), r.role_id, p.permission_id
FROM roles r
CROSS JOIN permissions p
WHERE r.role_name IN ('director-union', 'assistant-union')
  AND r.role_category = 'GLOBAL'
  AND r.active = true
  AND p.active = true
  AND p.permission_name IN ('member_rankings:read_union', 'section_rankings:read_union')
ON CONFLICT (role_id, permission_id) DO NOTHING;

INSERT INTO role_permissions (role_permission_id, role_id, permission_id)
SELECT gen_random_uuid(), r.role_id, p.permission_id
FROM roles r
CROSS JOIN permissions p
WHERE r.role_name IN ('director-dia', 'assistant-dia')
  AND r.role_category = 'GLOBAL'
  AND r.active = true
  AND p.active = true
  AND p.permission_name IN ('member_rankings:read_division', 'section_rankings:read_division')
ON CONFLICT (role_id, permission_id) DO NOTHING;
