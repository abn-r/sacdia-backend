-- AlterTable
ALTER TABLE "camporee_clubs" ADD COLUMN     "approved_by" UUID,
ADD COLUMN     "rejected_by" UUID,
ADD COLUMN     "rejection_reason" TEXT;

-- AlterTable
ALTER TABLE "camporee_members" ADD COLUMN     "approved_by" UUID,
ADD COLUMN     "rejected_by" UUID,
ADD COLUMN     "rejection_reason" TEXT,
ADD COLUMN     "status" VARCHAR(20) NOT NULL DEFAULT 'registered';

-- AlterTable
ALTER TABLE "camporee_payments" ADD COLUMN     "approved_by" UUID,
ADD COLUMN     "rejected_by" UUID,
ADD COLUMN     "rejection_reason" TEXT,
ADD COLUMN     "status" VARCHAR(20) NOT NULL DEFAULT 'registered';

-- AlterTable
ALTER TABLE "local_camporees" ADD COLUMN     "club_registration_deadline" TIMESTAMPTZ(6),
ADD COLUMN     "member_registration_deadline" TIMESTAMPTZ(6),
ADD COLUMN     "payment_deadline" TIMESTAMPTZ(6);

-- AlterTable
ALTER TABLE "union_camporees" ADD COLUMN     "club_registration_deadline" TIMESTAMPTZ(6),
ADD COLUMN     "member_registration_deadline" TIMESTAMPTZ(6),
ADD COLUMN     "payment_deadline" TIMESTAMPTZ(6);
