-- Revoke the unscoped ranking reads from union leadership.
--
-- 20260429000002_enrollment_rankings_seeds granted member_rankings:read_global
-- and section_rankings:read_global to director-union / assistant-union. In
-- MemberRankingsService and SectionRankingsService read_global means "no
-- restriction", so a union account could read the rankings of every union.
-- Canon (docs/canon/runtime-rankings.md §14.7) reserves read_global for
-- admin / super-admin. The role-permissions seed never granted it to unions.
--
-- Union leadership keeps member_ranking_weights:read. A union-scoped ranking
-- read tier does not exist yet; until it does, unions do not read rankings.
--
-- Idempotent: deleting rows that are already gone is a no-op.

DELETE FROM role_permissions rp
USING roles r, permissions p
WHERE rp.role_id = r.role_id
  AND rp.permission_id = p.permission_id
  AND r.role_name IN ('director-union', 'assistant-union')
  AND r.role_category = 'GLOBAL'
  AND p.permission_name IN ('member_rankings:read_global', 'section_rankings:read_global');
