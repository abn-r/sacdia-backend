-- DropForeignKey
ALTER TABLE "notification_logs" DROP CONSTRAINT "notification_logs_sent_by_fkey";

-- AlterTable
ALTER TABLE "notification_logs" ADD COLUMN     "source" VARCHAR(100),
ALTER COLUMN "sent_by" DROP NOT NULL;

-- AddForeignKey
ALTER TABLE "notification_logs" ADD CONSTRAINT "notification_logs_sent_by_fkey" FOREIGN KEY ("sent_by") REFERENCES "users"("user_id") ON DELETE SET NULL ON UPDATE CASCADE;
