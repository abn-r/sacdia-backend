-- AlterTable
ALTER TABLE "class_section_progress" ADD COLUMN     "rejection_reason" TEXT,
ADD COLUMN     "status" VARCHAR(20) NOT NULL DEFAULT 'pendiente',
ADD COLUMN     "submitted_at" TIMESTAMPTZ(6),
ADD COLUMN     "submitted_by_id" UUID,
ADD COLUMN     "validated_at" TIMESTAMPTZ(6),
ADD COLUMN     "validated_by_id" UUID;

-- AddForeignKey
ALTER TABLE "class_section_progress" ADD CONSTRAINT "class_section_progress_submitted_by_id_fkey" FOREIGN KEY ("submitted_by_id") REFERENCES "users"("user_id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "class_section_progress" ADD CONSTRAINT "class_section_progress_validated_by_id_fkey" FOREIGN KEY ("validated_by_id") REFERENCES "users"("user_id") ON DELETE NO ACTION ON UPDATE NO ACTION;
