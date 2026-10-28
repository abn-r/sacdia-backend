-- Restore the local field ranking reads that seed runs wiped.
--
-- 20260429000002_enrollment_rankings_seeds granted member_rankings:read_lf and
-- section_rankings:read_lf to director-lf / assistant-lf (and
-- member_ranking_weights:read to director-lf). The role-permissions seed then
-- DELETEs and reinserts those roles' rows without them, so any database where
-- the seed ran after that migration lost them. The seed now keeps them too.
--
-- Idempotent: ON CONFLICT DO NOTHING.

INSERT INTO role_permissions (role_permission_id, role_id, permission_id)
SELECT gen_random_uuid(), r.role_id, p.permission_id
FROM roles r
CROSS JOIN permissions p
WHERE r.role_name IN ('director-lf', 'assistant-lf')
  AND r.role_category = 'GLOBAL'
  AND r.active = true
  AND p.active = true
  AND p.permission_name IN ('member_rankings:read_lf', 'section_rankings:read_lf')
ON CONFLICT (role_id, permission_id) DO NOTHING;

INSERT INTO role_permissions (role_permission_id, role_id, permission_id)
SELECT gen_random_uuid(), r.role_id, p.permission_id
FROM roles r
CROSS JOIN permissions p
WHERE r.role_name = 'director-lf'
  AND r.role_category = 'GLOBAL'
  AND r.active = true
  AND p.active = true
  AND p.permission_name = 'member_ranking_weights:read'
ON CONFLICT (role_id, permission_id) DO NOTHING;
