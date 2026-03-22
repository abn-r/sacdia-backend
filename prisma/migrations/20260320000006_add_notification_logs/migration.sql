-- CreateTable
CREATE TABLE "notification_logs" (
    "log_id" SERIAL NOT NULL,
    "title" VARCHAR(255) NOT NULL,
    "body" TEXT NOT NULL,
    "type" VARCHAR(50) NOT NULL,
    "target_type" VARCHAR(50) NOT NULL,
    "target_id" VARCHAR(255),
    "sent_by" UUID NOT NULL,
    "tokens_sent" INTEGER NOT NULL DEFAULT 0,
    "tokens_failed" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notification_logs_pkey" PRIMARY KEY ("log_id")
);

-- CreateIndex
CREATE INDEX "idx_notification_logs_sender" ON "notification_logs"("sent_by");

-- CreateIndex
CREATE INDEX "idx_notification_logs_created" ON "notification_logs"("created_at");

-- AddForeignKey
ALTER TABLE "notification_logs" ADD CONSTRAINT "notification_logs_sent_by_fkey" FOREIGN KEY ("sent_by") REFERENCES "users"("user_id") ON DELETE RESTRICT ON UPDATE CASCADE;
