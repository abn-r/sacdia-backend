-- =============================================================================
-- Migration: units.active default + weekly_records.created_by audit field
-- =============================================================================

-- Step 1: Add DEFAULT true to units.active
ALTER TABLE "units" ALTER COLUMN "active" SET DEFAULT true;

-- Step 2: Add created_by column as nullable first (to allow backfill)
ALTER TABLE "weekly_records" ADD COLUMN "created_by" UUID;

-- Step 3: Backfill existing rows — use the record's own user_id as created_by
UPDATE "weekly_records" SET "created_by" = "user_id" WHERE "created_by" IS NULL;

-- Step 4: Now make the column NOT NULL
ALTER TABLE "weekly_records" ALTER COLUMN "created_by" SET NOT NULL;

-- Step 5: Add foreign key constraint to users
ALTER TABLE "weekly_records"
  ADD CONSTRAINT "weekly_records_created_by_fkey"
  FOREIGN KEY ("created_by") REFERENCES "users"("user_id")
  ON DELETE NO ACTION ON UPDATE NO ACTION;
