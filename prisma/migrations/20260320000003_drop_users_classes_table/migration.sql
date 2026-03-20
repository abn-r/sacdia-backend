-- Step 1: Archive the table before dropping (preserves certificate data)
CREATE TABLE IF NOT EXISTS "users_classes_archive" AS SELECT * FROM "users_classes";

-- Step 2: Drop FK constraints first
ALTER TABLE "users_classes" DROP CONSTRAINT IF EXISTS "users_classes_class_id_fkey";
ALTER TABLE "users_classes" DROP CONSTRAINT IF EXISTS "users_classes_user_id_fkey";

-- Step 3: Drop the table
DROP TABLE IF EXISTS "users_classes";
