-- ============================================================
-- Phase 5.1: Annual Folders Scoring
-- Adds scoring, evaluation, award categories, and rankings
-- ============================================================

-- AlterTable: folder_templates — add minimum_points, closing_date
ALTER TABLE "folder_templates" ADD COLUMN "minimum_points" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "folder_templates" ADD COLUMN "closing_date" TIMESTAMPTZ(6);

-- AlterTable: folder_template_sections — add max_points, minimum_points
ALTER TABLE "folder_template_sections" ADD COLUMN "max_points" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "folder_template_sections" ADD COLUMN "minimum_points" INTEGER NOT NULL DEFAULT 0;

-- AlterTable: annual_folders — add scoring fields
ALTER TABLE "annual_folders" ADD COLUMN "total_earned_points" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "annual_folders" ADD COLUMN "total_max_points" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "annual_folders" ADD COLUMN "progress_percentage" DOUBLE PRECISION NOT NULL DEFAULT 0;
ALTER TABLE "annual_folders" ADD COLUMN "evaluated_at" TIMESTAMPTZ(6);

-- CreateTable: annual_folder_section_evaluations
CREATE TABLE "annual_folder_section_evaluations" (
    "evaluation_id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "annual_folder_id" UUID NOT NULL,
    "section_id" UUID NOT NULL,
    "earned_points" INTEGER NOT NULL DEFAULT 0,
    "max_points" INTEGER NOT NULL DEFAULT 0,
    "notes" TEXT,
    "evaluated_by_id" UUID NOT NULL,
    "evaluated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "modified_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "annual_folder_section_evaluations_pkey" PRIMARY KEY ("evaluation_id")
);

-- CreateTable: award_categories
CREATE TABLE "award_categories" (
    "award_category_id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "name" VARCHAR(200) NOT NULL,
    "description" TEXT,
    "club_type_id" INTEGER,
    "min_points" INTEGER NOT NULL DEFAULT 0,
    "max_points" INTEGER,
    "icon" VARCHAR(100),
    "order" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "modified_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "award_categories_pkey" PRIMARY KEY ("award_category_id")
);

-- CreateTable: club_annual_rankings
CREATE TABLE "club_annual_rankings" (
    "ranking_id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "club_enrollment_id" UUID NOT NULL,
    "club_type_id" INTEGER NOT NULL,
    "ecclesiastical_year_id" INTEGER NOT NULL,
    "award_category_id" UUID,
    "total_earned_points" INTEGER NOT NULL DEFAULT 0,
    "total_max_points" INTEGER NOT NULL DEFAULT 0,
    "progress_percentage" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "rank_position" INTEGER,
    "calculated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "modified_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "club_annual_rankings_pkey" PRIMARY KEY ("ranking_id")
);

-- CreateIndex: annual_folder_section_evaluations
CREATE UNIQUE INDEX "annual_folder_section_evaluations_annual_folder_id_section_id_key" ON "annual_folder_section_evaluations"("annual_folder_id", "section_id");
CREATE INDEX "idx_annual_folder_section_evaluations_folder" ON "annual_folder_section_evaluations"("annual_folder_id");
CREATE INDEX "idx_annual_folder_section_evaluations_section" ON "annual_folder_section_evaluations"("section_id");
CREATE INDEX "idx_annual_folder_section_evaluations_evaluator" ON "annual_folder_section_evaluations"("evaluated_by_id");

-- CreateIndex: award_categories
CREATE INDEX "idx_award_categories_club_type" ON "award_categories"("club_type_id");

-- CreateIndex: club_annual_rankings
CREATE UNIQUE INDEX "club_annual_rankings_club_enrollment_id_ecclesiastical_year_id_award_category_id_key" ON "club_annual_rankings"("club_enrollment_id", "ecclesiastical_year_id", "award_category_id");
CREATE INDEX "idx_club_annual_rankings_club_type" ON "club_annual_rankings"("club_type_id");
CREATE INDEX "idx_club_annual_rankings_year" ON "club_annual_rankings"("ecclesiastical_year_id");
CREATE INDEX "idx_club_annual_rankings_category" ON "club_annual_rankings"("award_category_id");
CREATE INDEX "idx_club_annual_rankings_rank" ON "club_annual_rankings"("rank_position");

-- AddForeignKey: annual_folder_section_evaluations
ALTER TABLE "annual_folder_section_evaluations" ADD CONSTRAINT "annual_folder_section_evaluations_annual_folder_id_fkey" FOREIGN KEY ("annual_folder_id") REFERENCES "annual_folders"("annual_folder_id") ON DELETE CASCADE ON UPDATE NO ACTION;
ALTER TABLE "annual_folder_section_evaluations" ADD CONSTRAINT "annual_folder_section_evaluations_section_id_fkey" FOREIGN KEY ("section_id") REFERENCES "folder_template_sections"("section_id") ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE "annual_folder_section_evaluations" ADD CONSTRAINT "annual_folder_section_evaluations_evaluated_by_id_fkey" FOREIGN KEY ("evaluated_by_id") REFERENCES "users"("user_id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey: award_categories
ALTER TABLE "award_categories" ADD CONSTRAINT "award_categories_club_type_id_fkey" FOREIGN KEY ("club_type_id") REFERENCES "club_types"("club_type_id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey: club_annual_rankings
ALTER TABLE "club_annual_rankings" ADD CONSTRAINT "club_annual_rankings_club_enrollment_id_fkey" FOREIGN KEY ("club_enrollment_id") REFERENCES "club_enrollments"("club_enrollment_id") ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE "club_annual_rankings" ADD CONSTRAINT "club_annual_rankings_club_type_id_fkey" FOREIGN KEY ("club_type_id") REFERENCES "club_types"("club_type_id") ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE "club_annual_rankings" ADD CONSTRAINT "club_annual_rankings_ecclesiastical_year_id_fkey" FOREIGN KEY ("ecclesiastical_year_id") REFERENCES "ecclesiastical_years"("year_id") ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE "club_annual_rankings" ADD CONSTRAINT "club_annual_rankings_award_category_id_fkey" FOREIGN KEY ("award_category_id") REFERENCES "award_categories"("award_category_id") ON DELETE NO ACTION ON UPDATE NO ACTION;
