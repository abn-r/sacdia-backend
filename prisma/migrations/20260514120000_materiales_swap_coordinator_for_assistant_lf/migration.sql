-- Migration: 20260514120000_materiales_swap_coordinator_for_assistant_lf
-- Date: 2026-05-14
--
-- WHY THIS MIGRATION EXISTS
-- -------------------------
-- The campo-local role responsible for operating the Materiales module is
-- `assistant-lf`, not `coordinator`. The initial seed migration
-- (20260513200000_grant_materiales_to_campo_roles) granted the 8
-- materiales:* permissions to `coordinator` by mistake.
--
-- This migration:
--   1. Revokes all 8 materiales:* permissions from `coordinator` (GLOBAL)
--   2. Grants the same 8 permissions to `assistant-lf` (GLOBAL)
--
-- Idempotent on the grant side via ON CONFLICT DO NOTHING.
--
-- Depends on:
--   - 20260513190000_seed_materiales_permissions (permission rows exist)
--   - 20260513200000_grant_materiales_to_campo_roles (coordinator grants exist)

-- ─── Revoke coordinator (GLOBAL) from materiales:* ───────────────────────────

DELETE FROM role_permissions
WHERE role_id = (
    SELECT role_id FROM roles
    WHERE role_name = 'coordinator'
      AND role_category = 'GLOBAL'
      AND active = true
    LIMIT 1
  )
  AND permission_id IN (
    SELECT permission_id FROM permissions
    WHERE permission_name IN (
      'materiales:read',
      'materiales:create',
      'materiales:approve',
      'materiales:upload-receipt',
      'materiales:validate-receipt',
      'materiales:deliver',
      'materiales:manage-inventory',
      'materiales:configure'
    )
  );

-- ─── Grant assistant-lf (GLOBAL) all 8 materiales:* ──────────────────────────

INSERT INTO role_permissions (role_permission_id, role_id, permission_id)
SELECT gen_random_uuid(), r.role_id, p.permission_id
FROM roles r
JOIN permissions p ON p.permission_name = ANY(ARRAY[
  'materiales:read',
  'materiales:create',
  'materiales:approve',
  'materiales:upload-receipt',
  'materiales:validate-receipt',
  'materiales:deliver',
  'materiales:manage-inventory',
  'materiales:configure'
])
WHERE r.role_name = 'assistant-lf'
  AND r.role_category = 'GLOBAL'
  AND r.active = true
  AND p.active = true
ON CONFLICT (role_id, permission_id) DO NOTHING;
