-- GAP-W2-04: Fix typo in inventory_categories PK column name
-- Renames "inventory_categoty_id" (missing 'r') to "inventory_category_id"
--
-- Strategy:
--   1. Rename the PK column on inventory_categories (if the typo exists).
--      PostgreSQL automatically tracks FK references by column OID, so any FK
--      pointing to this column continues to work after the rename.
--   2. If the FK column on club_inventory also has the typo, rename it as well
--      and re-create the FK constraint.
--
-- Both blocks are guarded by IF EXISTS checks so this migration is idempotent:
-- running it against a DB that already has the correct column names is a no-op.

-- Step 1: Fix the PK column on inventory_categories
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name   = 'inventory_categories'
      AND column_name  = 'inventory_categoty_id'
  ) THEN
    ALTER TABLE "inventory_categories"
      RENAME COLUMN "inventory_categoty_id" TO "inventory_category_id";
  END IF;
END;
$$;

-- Step 2: Fix the FK column on club_inventory (if it also has the typo)
DO $$
DECLARE
  v_fk_name TEXT;
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name   = 'club_inventory'
      AND column_name  = 'inventory_categoty_id'
  ) THEN
    -- Locate the FK constraint name dynamically so we don't hard-code it
    SELECT rc.constraint_name
      INTO v_fk_name
      FROM information_schema.referential_constraints rc
      JOIN information_schema.key_column_usage kcu
        ON kcu.constraint_name  = rc.constraint_name
       AND kcu.constraint_schema = rc.constraint_schema
     WHERE kcu.table_schema = 'public'
       AND kcu.table_name   = 'club_inventory'
       AND kcu.column_name  = 'inventory_categoty_id'
     LIMIT 1;

    IF v_fk_name IS NOT NULL THEN
      EXECUTE format('ALTER TABLE "club_inventory" DROP CONSTRAINT %I', v_fk_name);
    END IF;

    ALTER TABLE "club_inventory"
      RENAME COLUMN "inventory_categoty_id" TO "inventory_category_id";

    -- Re-add the FK with the canonical constraint name Prisma expects
    ALTER TABLE "club_inventory"
      ADD CONSTRAINT "club_inventory_inventory_category_id_fkey"
      FOREIGN KEY ("inventory_category_id")
      REFERENCES "inventory_categories"("inventory_category_id")
      ON DELETE NO ACTION
      ON UPDATE NO ACTION;
  END IF;
END;
$$;
