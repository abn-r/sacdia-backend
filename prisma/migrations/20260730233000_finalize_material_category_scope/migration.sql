BEGIN;

LOCK TABLE local_fields IN SHARE MODE;
LOCK TABLE material_categories, material_products IN ACCESS EXCLUSIVE MODE;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM material_categories WHERE local_field_id IS NULL
  ) AND NOT EXISTS (
    SELECT 1 FROM local_fields
  ) THEN
    RAISE EXCEPTION USING MESSAGE = 'materials_category_scope_zero_local_fields';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM material_categories legacy
    JOIN material_categories scoped
      ON scoped.local_field_id IS NOT NULL AND scoped.slug = legacy.slug
    WHERE legacy.local_field_id IS NULL
  ) OR EXISTS (
    SELECT 1 FROM material_categories
    WHERE local_field_id IS NOT NULL
    GROUP BY local_field_id, slug HAVING COUNT(*) > 1
  ) OR EXISTS (
    SELECT 1 FROM material_categories
    WHERE local_field_id IS NULL
    GROUP BY slug HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION USING MESSAGE = 'materials_category_scope_slug_collision';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM material_products product
    JOIN material_categories category
      ON category.id = product.material_category_id
    WHERE category.local_field_id IS NOT NULL
      AND category.local_field_id <> product.local_field_id
  ) THEN
    RAISE EXCEPTION USING MESSAGE = 'materials_product_category_scope_mismatch';
  END IF;
END $$;

CREATE TEMP TABLE material_category_scope_map (
  source_category_id UUID NOT NULL,
  local_field_id INT NOT NULL,
  target_category_id UUID NOT NULL,
  PRIMARY KEY (source_category_id, local_field_id),
  UNIQUE (target_category_id)
) ON COMMIT DROP;

INSERT INTO material_category_scope_map
  (source_category_id, local_field_id, target_category_id)
SELECT category.id, field.local_field_id,
  CASE
    WHEN field.local_field_id = (SELECT MIN(local_field_id) FROM local_fields)
      THEN category.id
    ELSE md5(category.id::text || ':' || field.local_field_id::text)::uuid
  END
FROM material_categories category
CROSS JOIN local_fields field
WHERE category.local_field_id IS NULL
ORDER BY category.id, field.local_field_id;

ALTER TABLE material_categories
  DROP CONSTRAINT IF EXISTS material_categories_slug_key;
DROP INDEX IF EXISTS material_categories_slug_key;

INSERT INTO material_categories (
  id, local_field_id, slug, label, icon, sort_order, active, created_at, updated_at
)
SELECT mapping.target_category_id, mapping.local_field_id,
  source.slug, source.label, source.icon, source.sort_order, source.active,
  source.created_at, source.updated_at
FROM material_category_scope_map mapping
JOIN material_categories source ON source.id = mapping.source_category_id
WHERE mapping.target_category_id <> mapping.source_category_id;

UPDATE material_products product
SET material_category_id = mapping.target_category_id
FROM material_category_scope_map mapping
WHERE product.material_category_id = mapping.source_category_id
  AND product.local_field_id = mapping.local_field_id;

UPDATE material_categories category
SET local_field_id = mapping.local_field_id
FROM material_category_scope_map mapping
WHERE category.id = mapping.source_category_id
  AND mapping.target_category_id = mapping.source_category_id;

ALTER TABLE material_categories ALTER COLUMN local_field_id SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_material_categories_lf_slug
  ON material_categories (local_field_id, slug);
CREATE UNIQUE INDEX IF NOT EXISTS uq_material_categories_id_lf
  ON material_categories (id, local_field_id);

ALTER TABLE material_products
  DROP CONSTRAINT IF EXISTS material_products_category_fk;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'material_products'::regclass
      AND conname = 'material_products_category_scope_fk'
  ) THEN
    ALTER TABLE material_products
      ADD CONSTRAINT material_products_category_scope_fk
      FOREIGN KEY (material_category_id, local_field_id)
      REFERENCES material_categories (id, local_field_id)
      ON DELETE RESTRICT ON UPDATE NO ACTION;
  END IF;
END $$;

COMMIT;
