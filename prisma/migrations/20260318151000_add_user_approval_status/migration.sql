-- CreateEnum
CREATE TYPE "user_approval_status" AS ENUM ('pending', 'approved', 'rejected');

-- AlterTable
ALTER TABLE "users"
ADD COLUMN "approval_status" "user_approval_status" NOT NULL DEFAULT 'pending',
ADD COLUMN "rejection_reason" TEXT;
