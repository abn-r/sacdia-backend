-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "investiture_action_enum" ADD VALUE 'CLUB_APPROVED';
ALTER TYPE "investiture_action_enum" ADD VALUE 'COORDINATOR_APPROVED';
ALTER TYPE "investiture_action_enum" ADD VALUE 'FIELD_APPROVED';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "investiture_status_enum" ADD VALUE 'CLUB_APPROVED';
ALTER TYPE "investiture_status_enum" ADD VALUE 'COORDINATOR_APPROVED';
ALTER TYPE "investiture_status_enum" ADD VALUE 'FIELD_APPROVED';

-- AlterTable
ALTER TABLE "camporee_clubs" ADD COLUMN     "registered_by" UUID,
ADD COLUMN     "status" VARCHAR(20) NOT NULL DEFAULT 'registered';

-- CreateTable
CREATE TABLE "camporee_payments" (
    "camporee_payment_id" UUID NOT NULL DEFAULT extensions.uuid_generate_v4(),
    "camporee_member_id" INTEGER NOT NULL,
    "amount" DECIMAL(10,2) NOT NULL,
    "payment_type" VARCHAR(50) NOT NULL,
    "reference" VARCHAR(100),
    "notes" TEXT,
    "registered_by" UUID NOT NULL,
    "paid_at" DATE NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "modified_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "camporee_payments_pkey" PRIMARY KEY ("camporee_payment_id")
);

-- CreateIndex
CREATE INDEX "idx_camporee_payments_member_id" ON "camporee_payments"("camporee_member_id");

-- AddForeignKey
ALTER TABLE "camporee_clubs" ADD CONSTRAINT "camporee_clubs_registered_by_fkey" FOREIGN KEY ("registered_by") REFERENCES "users"("user_id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "camporee_payments" ADD CONSTRAINT "camporee_payments_camporee_member_id_fkey" FOREIGN KEY ("camporee_member_id") REFERENCES "camporee_members"("camporee_member_id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "camporee_payments" ADD CONSTRAINT "camporee_payments_registered_by_fkey" FOREIGN KEY ("registered_by") REFERENCES "users"("user_id") ON DELETE NO ACTION ON UPDATE NO ACTION;
