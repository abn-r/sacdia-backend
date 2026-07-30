BEGIN;

ALTER TABLE material_categories ADD COLUMN IF NOT EXISTS local_field_id INT;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM material_categories WHERE local_field_id IS NULL)
     AND NOT EXISTS (SELECT 1 FROM local_fields) THEN
    RAISE EXCEPTION 'Cannot scope legacy material categories: no local fields exist'
      USING ERRCODE = 'P0001';
  END IF;
END $$;

ALTER TABLE material_categories
  DROP CONSTRAINT IF EXISTS material_categories_slug_key;

INSERT INTO material_categories (id, local_field_id, slug, label, icon, sort_order, active, created_at, updated_at)
SELECT gen_random_uuid(), lf.local_field_id, category.slug, category.label,
  category.icon, category.sort_order, category.active, category.created_at, category.updated_at
FROM material_categories category CROSS JOIN local_fields lf
WHERE category.local_field_id IS NULL;

UPDATE material_products product
SET material_category_id = scoped_category.id
FROM material_categories legacy_category, material_categories scoped_category
WHERE legacy_category.id = product.material_category_id
  AND legacy_category.local_field_id IS NULL
  AND scoped_category.local_field_id = product.local_field_id
  AND scoped_category.slug = legacy_category.slug;

DELETE FROM material_categories WHERE local_field_id IS NULL;

ALTER TABLE material_categories
  ALTER COLUMN local_field_id SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'material_categories'::regclass
      AND conname = 'material_categories_local_field_id_fkey'
  ) THEN
    ALTER TABLE material_categories
      ADD CONSTRAINT material_categories_local_field_id_fkey
      FOREIGN KEY (local_field_id) REFERENCES local_fields (local_field_id)
      ON DELETE RESTRICT ON UPDATE NO ACTION;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'material_categories'::regclass
      AND conname = 'uq_material_categories_local_field_slug'
  ) THEN
    ALTER TABLE material_categories
      ADD CONSTRAINT uq_material_categories_local_field_slug
      UNIQUE (local_field_id, slug);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'material_categories'::regclass
      AND conname = 'uq_material_categories_id_local_field'
  ) THEN
    ALTER TABLE material_categories
      ADD CONSTRAINT uq_material_categories_id_local_field
      UNIQUE (id, local_field_id);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_material_categories_lf_active
  ON material_categories (local_field_id, active);

ALTER TABLE material_products
  DROP CONSTRAINT IF EXISTS material_products_category_fk;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'material_products'::regclass
      AND conname = 'material_products_category_lf_fk'
  ) THEN
    ALTER TABLE material_products
      ADD CONSTRAINT material_products_category_lf_fk
      FOREIGN KEY (material_category_id, local_field_id)
      REFERENCES material_categories (id, local_field_id)
      ON DELETE RESTRICT ON UPDATE NO ACTION;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS material_audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  local_field_id INT NOT NULL REFERENCES local_fields (local_field_id) ON DELETE RESTRICT ON UPDATE NO ACTION,
  actor_user_id UUID NOT NULL REFERENCES users (user_id) ON DELETE RESTRICT ON UPDATE NO ACTION,
  entity_type VARCHAR(64) NOT NULL,
  entity_id VARCHAR(64) NOT NULL,
  action VARCHAR(96) NOT NULL,
  before_json JSONB,
  after_json JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_material_audit_lf_created
  ON material_audit_logs (local_field_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_material_audit_entity_created
  ON material_audit_logs (entity_type, entity_id, created_at DESC);

COMMIT;
