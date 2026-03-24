-- CreateTable
CREATE TABLE "monthly_reports" (
    "monthly_report_id" UUID NOT NULL DEFAULT extensions.uuid_generate_v4(),
    "club_enrollment_id" UUID NOT NULL,
    "month" INTEGER NOT NULL,
    "year" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "generated_at" TIMESTAMPTZ(6),
    "submitted_at" TIMESTAMPTZ(6),
    "submitted_by" UUID,
    "snapshot_data" JSONB,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "modified_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "monthly_reports_pkey" PRIMARY KEY ("monthly_report_id")
);

-- CreateTable
CREATE TABLE "monthly_report_manual_data" (
    "manual_data_id" UUID NOT NULL DEFAULT extensions.uuid_generate_v4(),
    "monthly_report_id" UUID NOT NULL,
    "planning_meetings" INTEGER NOT NULL DEFAULT 0,
    "parent_meetings" INTEGER NOT NULL DEFAULT 0,
    "youth_council_attendance" INTEGER NOT NULL DEFAULT 0,
    "church_board_attendance" INTEGER NOT NULL DEFAULT 0,
    "soul_target" INTEGER NOT NULL DEFAULT 0,
    "unbaptized_members" INTEGER NOT NULL DEFAULT 0,
    "bible_studies_receiving" INTEGER NOT NULL DEFAULT 0,
    "has_weekly_bible_instruction" BOOLEAN NOT NULL DEFAULT false,
    "bible_studies_given" BOOLEAN NOT NULL DEFAULT false,
    "literature_distributed" BOOLEAN NOT NULL DEFAULT false,
    "baptized_this_month" INTEGER NOT NULL DEFAULT 0,
    "total_baptized" INTEGER NOT NULL DEFAULT 0,
    "club_participation_description" TEXT,
    "community_service_description" TEXT,
    "certificates_delivered" BOOLEAN NOT NULL DEFAULT false,
    "members_have_booklet" BOOLEAN NOT NULL DEFAULT false,
    "booklet_requirements_signed" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "modified_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "monthly_report_manual_data_pkey" PRIMARY KEY ("manual_data_id")
);

-- CreateIndex
CREATE INDEX "idx_monthly_reports_enrollment" ON "monthly_reports"("club_enrollment_id");

-- CreateIndex
CREATE INDEX "idx_monthly_reports_status" ON "monthly_reports"("status");

-- CreateIndex
CREATE UNIQUE INDEX "monthly_reports_club_enrollment_id_month_year_key" ON "monthly_reports"("club_enrollment_id", "month", "year");

-- CreateIndex
CREATE UNIQUE INDEX "monthly_report_manual_data_monthly_report_id_key" ON "monthly_report_manual_data"("monthly_report_id");

-- CreateIndex
CREATE INDEX "idx_monthly_report_manual_data_report" ON "monthly_report_manual_data"("monthly_report_id");

-- AddForeignKey
ALTER TABLE "monthly_reports" ADD CONSTRAINT "monthly_reports_club_enrollment_id_fkey" FOREIGN KEY ("club_enrollment_id") REFERENCES "club_enrollments"("club_enrollment_id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "monthly_reports" ADD CONSTRAINT "monthly_reports_submitted_by_fkey" FOREIGN KEY ("submitted_by") REFERENCES "users"("user_id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "monthly_report_manual_data" ADD CONSTRAINT "monthly_report_manual_data_monthly_report_id_fkey" FOREIGN KEY ("monthly_report_id") REFERENCES "monthly_reports"("monthly_report_id") ON DELETE CASCADE ON UPDATE NO ACTION;
