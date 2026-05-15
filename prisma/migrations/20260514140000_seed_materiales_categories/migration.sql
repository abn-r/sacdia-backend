-- Migration: 20260514140000_seed_materiales_categories
-- Date: 2026-05-14
--
-- Seeds the global taxonomy of material categories shared across all
-- local_fields. Admins can later create / deactivate categories through
-- the new `/dashboard/materiales/categorias` UI, but every fresh
-- environment should ship with the standard SACDIA taxonomy so directors
-- have something to browse from day one.
--
-- Idempotent: ON CONFLICT (slug) DO NOTHING.
-- Depends on: 20260513180000_materiales_init (material_categories exists).

INSERT INTO material_categories (id, slug, label, icon, sort_order, active, created_at, updated_at)
VALUES
  (gen_random_uuid(), 'uniforme',     'Uniforme',          'shirt',       10, true, NOW(), NOW()),
  (gen_random_uuid(), 'pañoleta',     'Pañoletas',         'flag',        20, true, NOW(), NOW()),
  (gen_random_uuid(), 'libros',       'Libros y manuales', 'book-open',   30, true, NOW(), NOW()),
  (gen_random_uuid(), 'distintivos',  'Distintivos',       'badge',       40, true, NOW(), NOW()),
  (gen_random_uuid(), 'insignias',    'Insignias',         'star',        50, true, NOW(), NOW()),
  (gen_random_uuid(), 'pines',        'Pines y broches',   'pin',         60, true, NOW(), NOW()),
  (gen_random_uuid(), 'mochilas',     'Mochilas y bolsas', 'backpack',    70, true, NOW(), NOW()),
  (gen_random_uuid(), 'accesorios',   'Accesorios',        'package',     80, true, NOW(), NOW())
ON CONFLICT (slug) DO NOTHING;
