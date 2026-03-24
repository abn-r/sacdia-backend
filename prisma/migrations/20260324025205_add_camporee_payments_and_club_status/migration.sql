-- AlterTable: Add status and registered_by to camporee_clubs
ALTER TABLE "camporee_clubs" ADD COLUMN IF NOT EXISTS "status" VARCHAR(20) NOT NULL DEFAULT 'registered';
ALTER TABLE "camporee_clubs" ADD COLUMN IF NOT EXISTS "registered_by" UUID;

-- AddForeignKey: camporee_clubs.registered_by -> users.user_id
ALTER TABLE "camporee_clubs" ADD CONSTRAINT "camporee_clubs_registered_by_fkey" FOREIGN KEY ("registered_by") REFERENCES "users"("user_id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- CreateTable: camporee_payments
CREATE TABLE IF NOT EXISTS "camporee_payments" (
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
CREATE INDEX IF NOT EXISTS "idx_camporee_payments_member_id" ON "camporee_payments"("camporee_member_id");

-- AddForeignKey: camporee_payments.camporee_member_id -> camporee_members.camporee_member_id
ALTER TABLE "camporee_payments" ADD CONSTRAINT "camporee_payments_camporee_member_id_fkey" FOREIGN KEY ("camporee_member_id") REFERENCES "camporee_members"("camporee_member_id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey: camporee_payments.registered_by -> users.user_id
ALTER TABLE "camporee_payments" ADD CONSTRAINT "camporee_payments_registered_by_fkey" FOREIGN KEY ("registered_by") REFERENCES "users"("user_id") ON DELETE NO ACTION ON UPDATE NO ACTION;
