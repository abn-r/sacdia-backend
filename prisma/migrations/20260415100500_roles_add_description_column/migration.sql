-- Migration: 20260415100500_roles_add_description_column
-- Adds description column to roles table.
-- Strategy: add as nullable first, backfill placeholder for existing rows,
-- then add NOT NULL constraint. This is safe for tables with existing data.

-- Step 1: Add column as nullable
ALTER TABLE "roles"
  ADD COLUMN "description" VARCHAR(500);

-- Step 2: Backfill existing rows with a placeholder description
UPDATE "roles"
  SET "description" = CONCAT('Role: ', role_name)
  WHERE "description" IS NULL;

-- Step 3: Apply NOT NULL constraint now that all rows have a value
ALTER TABLE "roles"
  ALTER COLUMN "description" SET NOT NULL;
