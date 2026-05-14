-- Migration: 20260513200000_grant_materiales_to_campo_roles
-- Date: 2026-05-13
--
-- WHY THIS MIGRATION EXISTS
-- -------------------------
-- Extends the materiales:* permission grants to the remaining campo-level
-- GLOBAL roles that were not covered in the initial seed migration:
--   - director-lf (LF-level director)
--   - coordinator (zonal coordinator)
--
-- Both roles operate at campo local level and need full operational access
-- to the materiales module (approve orders, validate receipts, manage
-- inventory, configure bank account/delivery).
--
-- Idempotent: ON CONFLICT DO NOTHING throughout.
--
-- Depends on:
--   - 20260513190000_seed_materiales_permissions (permission rows exist)

-- director-lf (GLOBAL): all 8 permissions
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
WHERE r.role_name = 'director-lf'
  AND r.role_category = 'GLOBAL'
  AND r.active = true
  AND p.active = true
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- coordinator (GLOBAL): all 8 permissions
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
WHERE r.role_name = 'coordinator'
  AND r.role_category = 'GLOBAL'
  AND r.active = true
  AND p.active = true
ON CONFLICT (role_id, permission_id) DO NOTHING;
