-- Migration: add_clinical_metadata_to_user_junctions
-- Adds severity_level enum + severity column to users_allergies,
-- since_year to users_diseases, dose to users_medicines.
--
-- Apply manually via psql on the Neon dev branch (shadow DB is broken),
-- then mark as applied: prisma migrate resolve --applied 20260513100000_add_clinical_metadata_to_user_junctions

-- Step 1: create severity_level enum type
CREATE TYPE "severity_level" AS ENUM ('leve', 'media', 'alta');

-- Step 2: add severity column to users_allergies
-- Using NOT NULL with DEFAULT 'leve' so existing rows are backfilled automatically.
ALTER TABLE "users_allergies"
  ADD COLUMN "severity" "severity_level" NOT NULL DEFAULT 'leve';

-- Step 3: add since_year column to users_diseases (nullable, no default)
ALTER TABLE "users_diseases"
  ADD COLUMN "since_year" INTEGER;

-- Step 4: add dose column to users_medicines (nullable varchar, no default)
ALTER TABLE "users_medicines"
  ADD COLUMN "dose" VARCHAR(255);
