-- The club treasurer views and downloads monthly reports but no longer drafts,
-- edits, generates, submits or regenerates them (decision 2026-11-02): that
-- belongs to the club board (director, deputy-director, secretary,
-- secretary-treasurer).
--
-- 20261025120000 and 20261026120000 gave reports:submit and reports:write to
-- every role holding reports:read, the treasurer included. The seed treasurer
-- block drops both; this migration removes the rows on existing databases.
--
-- Idempotent: deleting rows already gone is a no-op.

DELETE FROM role_permissions rp
USING roles r, permissions p
WHERE rp.role_id = r.role_id
  AND rp.permission_id = p.permission_id
  AND r.role_name = 'treasurer'
  AND r.role_category = 'CLUB'
  AND p.permission_name IN ('reports:submit', 'reports:write');
