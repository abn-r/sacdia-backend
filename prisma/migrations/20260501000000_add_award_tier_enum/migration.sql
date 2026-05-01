-- CreateEnum
CREATE TYPE "award_tier_enum" AS ENUM ('BRONZE', 'SILVER', 'GOLD', 'DIAMOND');

-- AlterTable
ALTER TABLE "award_categories" ADD COLUMN "tier" "award_tier_enum";
