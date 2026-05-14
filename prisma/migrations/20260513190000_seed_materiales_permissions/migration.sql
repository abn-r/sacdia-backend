-- Migration: 20260513190000_seed_materiales_permissions
-- Date: 2026-05-13
--
-- WHY THIS MIGRATION EXISTS
-- -------------------------
-- Seeds 8 permissions for the Materiales module and grants them to the
-- relevant roles.
--
-- Role mapping (verified against role-permissions.seed.sql):
--   design assumption       → real role_name (role_category)
--   'director'              → 'director'   (CLUB)     — club director who creates orders
--   'campo_local_admin'     → 'admin'      (GLOBAL)   — campo-level admin (no exact match; admin is the closest)
--   'super_admin'           → 'super-admin' (GLOBAL)  — supreme platform administrator
--
-- NOTE: 'super-admin' already gets ALL active permissions via its seed grant
-- (role-permissions.seed.sql line 1791-1799). This migration adds the 8 new
-- permissions so the next seed run picks them up. The INSERT below is still
-- included for bootstrap safety (ON CONFLICT DO NOTHING).
--
-- Idempotent: ON CONFLICT DO NOTHING throughout.
--
-- Depends on: migration 20260513180000_materiales_init (tables must exist)
--             roles table (director, admin, super-admin must exist)

-- ─── 8 Materiales permissions ────────────────────────────────────────────────

INSERT INTO permissions (permission_name, description, active)
VALUES
  ('materiales:read',             'Ver catálogo y órdenes de materiales',     true),
  ('materiales:create',           'Crear órdenes de materiales',              true),
  ('materiales:approve',          'Revisar líneas y aprobar/cancelar órdenes',true),
  ('materiales:upload-receipt',   'Subir comprobantes de pago',               true),
  ('materiales:validate-receipt', 'Aprobar/rechazar comprobantes',            true),
  ('materiales:deliver',          'Marcar órdenes como entregadas',           true),
  ('materiales:manage-inventory', 'CRUD de productos e inventario',           true),
  ('materiales:configure',        'Editar configuración bancaria y de entrega',true)
ON CONFLICT (permission_name) DO NOTHING;

-- ─── Role grants ─────────────────────────────────────────────────────────────

-- director (CLUB): read, create, upload-receipt
INSERT INTO role_permissions (role_permission_id, role_id, permission_id)
SELECT gen_random_uuid(), r.role_id, p.permission_id
FROM roles r
JOIN permissions p ON p.permission_name = ANY(ARRAY[
  'materiales:read',
  'materiales:create',
  'materiales:upload-receipt'
])
WHERE r.role_name = 'director'
  AND r.role_category = 'CLUB'
  AND r.active = true
  AND p.active = true
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- admin (GLOBAL) — campo-level admin: all 8 permissions
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
WHERE r.role_name = 'admin'
  AND r.role_category = 'GLOBAL'
  AND r.active = true
  AND p.active = true
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- super-admin (GLOBAL): all 8 permissions
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
WHERE r.role_name = 'super-admin'
  AND r.role_category = 'GLOBAL'
  AND r.active = true
  AND p.active = true
ON CONFLICT (role_id, permission_id) DO NOTHING;
