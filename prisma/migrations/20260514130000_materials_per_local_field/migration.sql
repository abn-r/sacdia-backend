-- Migration: 20260514130000_materiales_per_local_field
-- Date: 2026-05-14
--
-- WHY THIS MIGRATION EXISTS
-- -------------------------
-- The materiales module was originally modelled with a single global
-- catalog, single bank account, and single folio counter — under the
-- (incorrect) assumption that "campo local" was a unique entity.
-- SACDIA actually has multiple local_fields, each operating its own
-- inventory, bank account, and folio sequence.
--
-- This migration refactors the schema so every product, config row,
-- folio counter, and order is scoped to a local_field:
--
--   1. material_products: add local_field_id NOT NULL FK; replace
--      sku UNIQUE with UNIQUE(local_field_id, sku).
--   2. material_config: drop the singleton row, change PK from id to
--      local_field_id. Each local_field has its own bank/delivery config.
--   3. material_folio_counters: PK becomes (local_field_id, year) — two
--      local_fields can hold the same per-year sequence in parallel.
--   4. material_orders: add local_field_id NOT NULL FK; replace the
--      folio_referencia UNIQUE with UNIQUE(local_field_id, folio_referencia).
--
-- Tables are empty in dev/staging/prod (only one material_config
-- singleton row existed, which is deleted below). No data backfill
-- required.
--
-- Categories stay GLOBAL (shared taxonomy). Variants stay tied to
-- products (transitive scope).
--
-- Idempotent guards: each ALTER uses IF NOT EXISTS / IF EXISTS where
-- the operation supports it. Index drops/creates wrapped accordingly.
--
-- Depends on:
--   - 20260513180000_materiales_init (tables exist)
--   - 20260513190000_seed_materiales_permissions
--   - 20260513200000_grant_materiales_to_campo_roles
--   - 20260513200000+12000_materiales_swap_coordinator_for_assistant_lf
--   - local_fields table (referenced FK)

-- ─── 1. material_products: add local_field_id + (local_field_id, sku) UNIQUE ──

ALTER TABLE material_products
  ADD COLUMN IF NOT EXISTS local_field_id INT;

ALTER TABLE material_products
  ADD CONSTRAINT material_products_local_field_id_fkey
    FOREIGN KEY (local_field_id) REFERENCES local_fields (local_field_id)
    ON DELETE RESTRICT ON UPDATE NO ACTION;

-- Empty table — no backfill needed
ALTER TABLE material_products
  ALTER COLUMN local_field_id SET NOT NULL;

ALTER TABLE material_products DROP CONSTRAINT IF EXISTS material_products_sku_key;
DROP INDEX IF EXISTS material_products_sku_key;

CREATE UNIQUE INDEX IF NOT EXISTS uq_material_products_local_field_sku
  ON material_products (local_field_id, sku);

CREATE INDEX IF NOT EXISTS idx_material_products_local_field_id
  ON material_products (local_field_id);

-- Replace the legacy multi-column index that didn't include local_field_id
DROP INDEX IF EXISTS idx_material_products_active_type_cat;
CREATE INDEX IF NOT EXISTS idx_material_products_lf_active_type_cat
  ON material_products (local_field_id, active, club_type_id, material_category_id);

-- ─── 2. material_config: PK becomes local_field_id, drop singleton ──────────

DELETE FROM material_config WHERE id = 1;

ALTER TABLE material_config DROP CONSTRAINT IF EXISTS material_config_pkey;
ALTER TABLE material_config DROP COLUMN IF EXISTS id;

ALTER TABLE material_config
  ADD COLUMN IF NOT EXISTS local_field_id INT;

-- Empty after the DELETE above — no backfill needed
ALTER TABLE material_config
  ALTER COLUMN local_field_id SET NOT NULL;

ALTER TABLE material_config
  ADD CONSTRAINT material_config_pkey PRIMARY KEY (local_field_id);

ALTER TABLE material_config
  ADD CONSTRAINT material_config_local_field_id_fkey
    FOREIGN KEY (local_field_id) REFERENCES local_fields (local_field_id)
    ON DELETE CASCADE ON UPDATE NO ACTION;

-- ─── 3. material_folio_counters: composite PK (local_field_id, year) ────────

ALTER TABLE material_folio_counters DROP CONSTRAINT IF EXISTS material_folio_counters_pkey;

ALTER TABLE material_folio_counters
  ADD COLUMN IF NOT EXISTS local_field_id INT;

-- Empty table — no backfill
ALTER TABLE material_folio_counters
  ALTER COLUMN local_field_id SET NOT NULL;

ALTER TABLE material_folio_counters
  ADD CONSTRAINT material_folio_counters_pkey PRIMARY KEY (local_field_id, year);

ALTER TABLE material_folio_counters
  ADD CONSTRAINT material_folio_counters_local_field_id_fkey
    FOREIGN KEY (local_field_id) REFERENCES local_fields (local_field_id)
    ON DELETE CASCADE ON UPDATE NO ACTION;

-- ─── 4. material_orders: add local_field_id + scoped folio UNIQUE ──────────

ALTER TABLE material_orders
  ADD COLUMN IF NOT EXISTS local_field_id INT;

ALTER TABLE material_orders
  ADD CONSTRAINT material_orders_local_field_id_fkey
    FOREIGN KEY (local_field_id) REFERENCES local_fields (local_field_id)
    ON DELETE RESTRICT ON UPDATE NO ACTION;

-- Empty table — no backfill
ALTER TABLE material_orders
  ALTER COLUMN local_field_id SET NOT NULL;

-- Drop global folio_referencia UNIQUE, replace with scoped UNIQUE
ALTER TABLE material_orders
  DROP CONSTRAINT IF EXISTS material_orders_folio_key;
ALTER TABLE material_orders
  DROP CONSTRAINT IF EXISTS material_orders_folio_referencia_key;
DROP INDEX IF EXISTS material_orders_folio_key;
DROP INDEX IF EXISTS material_orders_folio_referencia_key;

CREATE UNIQUE INDEX IF NOT EXISTS uq_material_orders_lf_folio_ref
  ON material_orders (local_field_id, folio_referencia)
  WHERE folio_referencia IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_material_orders_local_field_id
  ON material_orders (local_field_id);
