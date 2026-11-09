-- Drop the global UNIQUE on material_orders.folio_referencia.
--
-- 20260514130000_materials_per_local_field replaced it with the per local
-- field unique index uq_material_orders_lf_folio_ref, but staging and
-- production kept material_orders_folio_key. There, two local fields cannot
-- issue the same folio (SOL{yyyy}{####} counts per local field and year).
-- Development already matches the schema.
--
-- Idempotent: no-op where the constraint is already gone.

ALTER TABLE material_orders
  DROP CONSTRAINT IF EXISTS material_orders_folio_key;
DROP INDEX IF EXISTS material_orders_folio_key;
