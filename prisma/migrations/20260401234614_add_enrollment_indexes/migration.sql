-- CreateIndex
CREATE INDEX IF NOT EXISTS "idx_enrollments_class_id" ON "enrollments"("class_id");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "idx_enrollments_user_investiture_active" ON "enrollments"("user_id", "investiture_status", "active");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "idx_enrollments_user_year_active" ON "enrollments"("user_id", "ecclesiastical_year_id", "active");
