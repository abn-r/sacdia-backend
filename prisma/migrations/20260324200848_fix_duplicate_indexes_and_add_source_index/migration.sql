-- CreateIndex
CREATE INDEX "idx_notification_logs_source" ON "notification_logs"("source");

-- CreateIndex
CREATE INDEX "idx_notification_preferences_category_enabled" ON "notification_preferences"("category", "enabled");
