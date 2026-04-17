-- CreateTable: notification_deliveries
-- Mailbox-per-user pattern for notification inbox.
-- One row per (notification_log, recipient) so that
-- regular users can query their own inbox without joining
-- against RBAC tables.

CREATE TABLE "notification_deliveries" (
    "delivery_id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "log_id" INTEGER NOT NULL,
    "user_id" UUID NOT NULL,
    "read_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),

    CONSTRAINT "notification_deliveries_pkey" PRIMARY KEY ("delivery_id")
);

-- CreateIndex: unique (log_id, user_id) — prevents duplicate deliveries per send event
CREATE UNIQUE INDEX "notification_deliveries_log_id_user_id_key"
    ON "notification_deliveries"("log_id", "user_id");

-- CreateIndex: inbox query (user_id + created_at DESC)
CREATE INDEX "notification_deliveries_user_id_created_at_idx"
    ON "notification_deliveries"("user_id", "created_at" DESC);

-- CreateIndex: unread count query (user_id + read_at)
CREATE INDEX "notification_deliveries_user_id_read_at_idx"
    ON "notification_deliveries"("user_id", "read_at");

-- AddForeignKey: notification_deliveries → notification_logs (cascade delete)
ALTER TABLE "notification_deliveries"
    ADD CONSTRAINT "notification_deliveries_log_id_fkey"
    FOREIGN KEY ("log_id") REFERENCES "notification_logs"("log_id")
    ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey: notification_deliveries → users (cascade delete)
ALTER TABLE "notification_deliveries"
    ADD CONSTRAINT "notification_deliveries_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("user_id")
    ON DELETE CASCADE ON UPDATE CASCADE;
