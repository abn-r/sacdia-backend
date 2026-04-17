-- AlterTable
ALTER TABLE "users_honors" ADD COLUMN     "rejection_reason" TEXT,
ADD COLUMN     "submitted_at" TIMESTAMPTZ(6),
ADD COLUMN     "validated_at" TIMESTAMPTZ(6),
ADD COLUMN     "validated_by_id" UUID;

-- CreateIndex
CREATE INDEX "idx_users_honors_validation_status" ON "users_honors"("validation_status");

-- AddForeignKey
ALTER TABLE "users_honors" ADD CONSTRAINT "users_honors_validated_by_id_fkey" FOREIGN KEY ("validated_by_id") REFERENCES "users"("user_id") ON DELETE NO ACTION ON UPDATE NO ACTION;
