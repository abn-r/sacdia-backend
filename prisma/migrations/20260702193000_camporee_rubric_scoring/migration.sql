ALTER TABLE "camporee_events"
  ADD COLUMN IF NOT EXISTS "scoring_enabled" BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE "camporee_event_templates"
  ADD COLUMN IF NOT EXISTS "scoring_enabled" BOOLEAN NOT NULL DEFAULT FALSE;

CREATE TABLE IF NOT EXISTS "camporee_event_template_rubrics" (
  "camporee_event_template_rubric_id" SERIAL PRIMARY KEY,
  "event_template_id" INTEGER NOT NULL,
  "title" VARCHAR(120) NOT NULL,
  "description" TEXT,
  "max_points" NUMERIC(10,2) NOT NULL,
  "display_order" INTEGER NOT NULL DEFAULT 0,
  "active" BOOLEAN NOT NULL DEFAULT TRUE,
  "created_by" UUID,
  "modified_by" UUID,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "modified_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT "camporee_event_template_rubrics_template_fkey"
    FOREIGN KEY ("event_template_id")
    REFERENCES "camporee_event_templates"("event_template_id")
    ON DELETE CASCADE,
  CONSTRAINT "camporee_event_template_rubrics_max_points_check"
    CHECK ("max_points" > 0)
);

CREATE INDEX IF NOT EXISTS "idx_camporee_event_template_rubrics_template_active"
  ON "camporee_event_template_rubrics"("event_template_id", "active", "display_order");

CREATE TABLE IF NOT EXISTS "camporee_event_rubrics" (
  "camporee_event_rubric_id" SERIAL PRIMARY KEY,
  "camporee_event_id" INTEGER NOT NULL,
  "title" VARCHAR(120) NOT NULL,
  "description" TEXT,
  "max_points" NUMERIC(10,2) NOT NULL,
  "display_order" INTEGER NOT NULL DEFAULT 0,
  "active" BOOLEAN NOT NULL DEFAULT TRUE,
  "created_by" UUID,
  "modified_by" UUID,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "modified_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT "camporee_event_rubrics_event_fkey"
    FOREIGN KEY ("camporee_event_id")
    REFERENCES "camporee_events"("camporee_event_id")
    ON DELETE CASCADE,
  CONSTRAINT "camporee_event_rubrics_max_points_check"
    CHECK ("max_points" > 0)
);

CREATE INDEX IF NOT EXISTS "idx_camporee_event_rubrics_event_active"
  ON "camporee_event_rubrics"("camporee_event_id", "active", "display_order");

CREATE TABLE IF NOT EXISTS "camporee_judges" (
  "camporee_judge_id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "local_camporee_id" INTEGER,
  "union_camporee_id" INTEGER,
  "user_id" UUID NOT NULL,
  "status" VARCHAR(20) NOT NULL DEFAULT 'active',
  "notes" TEXT,
  "active" BOOLEAN NOT NULL DEFAULT TRUE,
  "created_by" UUID,
  "modified_by" UUID,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "modified_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT "camporee_judges_scope_check"
    CHECK (
      ("local_camporee_id" IS NOT NULL AND "union_camporee_id" IS NULL)
      OR
      ("local_camporee_id" IS NULL AND "union_camporee_id" IS NOT NULL)
    ),
  CONSTRAINT "camporee_judges_local_fkey"
    FOREIGN KEY ("local_camporee_id") REFERENCES "local_camporees"("local_camporee_id") ON DELETE CASCADE,
  CONSTRAINT "camporee_judges_union_fkey"
    FOREIGN KEY ("union_camporee_id") REFERENCES "union_camporees"("union_camporee_id") ON DELETE CASCADE,
  CONSTRAINT "camporee_judges_user_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("user_id") ON DELETE NO ACTION
);

CREATE UNIQUE INDEX IF NOT EXISTS "uq_camporee_judges_local_user_active"
  ON "camporee_judges"("local_camporee_id", "user_id")
  WHERE "active" = TRUE AND "local_camporee_id" IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS "uq_camporee_judges_union_user_active"
  ON "camporee_judges"("union_camporee_id", "user_id")
  WHERE "active" = TRUE AND "union_camporee_id" IS NOT NULL;

CREATE TABLE IF NOT EXISTS "camporee_event_judge_assignments" (
  "camporee_event_judge_assignment_id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "camporee_event_id" INTEGER NOT NULL,
  "camporee_judge_id" UUID NOT NULL,
  "camporee_club_id" INTEGER,
  "club_section_id" INTEGER NOT NULL,
  "judge_role" VARCHAR(20) NOT NULL,
  "active" BOOLEAN NOT NULL DEFAULT TRUE,
  "created_by" UUID,
  "modified_by" UUID,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "modified_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT "camporee_event_judge_assignments_role_check"
    CHECK ("judge_role" IN ('primary', 'assistant')),
  CONSTRAINT "camporee_event_judge_assignments_event_fkey"
    FOREIGN KEY ("camporee_event_id") REFERENCES "camporee_events"("camporee_event_id") ON DELETE CASCADE,
  CONSTRAINT "camporee_event_judge_assignments_judge_fkey"
    FOREIGN KEY ("camporee_judge_id") REFERENCES "camporee_judges"("camporee_judge_id") ON DELETE CASCADE,
  CONSTRAINT "camporee_event_judge_assignments_camporee_club_fkey"
    FOREIGN KEY ("camporee_club_id") REFERENCES "camporee_clubs"("camporee_club_id") ON DELETE SET NULL,
  CONSTRAINT "camporee_event_judge_assignments_section_fkey"
    FOREIGN KEY ("club_section_id") REFERENCES "club_sections"("club_section_id") ON DELETE NO ACTION
);

CREATE UNIQUE INDEX IF NOT EXISTS "uq_camporee_event_primary_judge_section"
  ON "camporee_event_judge_assignments"("camporee_event_id", "club_section_id")
  WHERE "active" = TRUE AND "judge_role" = 'primary';

CREATE INDEX IF NOT EXISTS "idx_camporee_event_judge_assignments_judge"
  ON "camporee_event_judge_assignments"("camporee_judge_id", "active");

CREATE TABLE IF NOT EXISTS "camporee_event_score_submissions" (
  "camporee_event_score_submission_id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "camporee_event_id" INTEGER NOT NULL,
  "camporee_club_id" INTEGER,
  "club_section_id" INTEGER NOT NULL,
  "judge_assignment_id" UUID,
  "submitted_by" UUID NOT NULL,
  "source" VARCHAR(30) NOT NULL,
  "status" VARCHAR(20) NOT NULL DEFAULT 'submitted',
  "total_awarded_points" NUMERIC(10,2) NOT NULL DEFAULT 0,
  "total_max_points" NUMERIC(10,2) NOT NULL DEFAULT 0,
  "notes" TEXT,
  "voided_reason" TEXT,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "modified_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT "camporee_event_score_submissions_source_check"
    CHECK ("source" IN ('judge_primary', 'manual_lf', 'admin_override')),
  CONSTRAINT "camporee_event_score_submissions_status_check"
    CHECK ("status" IN ('submitted', 'voided')),
  CONSTRAINT "camporee_event_score_submissions_event_fkey"
    FOREIGN KEY ("camporee_event_id") REFERENCES "camporee_events"("camporee_event_id") ON DELETE CASCADE,
  CONSTRAINT "camporee_event_score_submissions_camporee_club_fkey"
    FOREIGN KEY ("camporee_club_id") REFERENCES "camporee_clubs"("camporee_club_id") ON DELETE SET NULL,
  CONSTRAINT "camporee_event_score_submissions_section_fkey"
    FOREIGN KEY ("club_section_id") REFERENCES "club_sections"("club_section_id") ON DELETE NO ACTION,
  CONSTRAINT "camporee_event_score_submissions_assignment_fkey"
    FOREIGN KEY ("judge_assignment_id") REFERENCES "camporee_event_judge_assignments"("camporee_event_judge_assignment_id") ON DELETE SET NULL,
  CONSTRAINT "camporee_event_score_submissions_submitter_fkey"
    FOREIGN KEY ("submitted_by") REFERENCES "users"("user_id") ON DELETE NO ACTION
);

CREATE INDEX IF NOT EXISTS "idx_camporee_event_score_submissions_event_section"
  ON "camporee_event_score_submissions"("camporee_event_id", "club_section_id", "created_at");

CREATE TABLE IF NOT EXISTS "camporee_event_score_submission_items" (
  "camporee_event_score_submission_item_id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "camporee_event_score_submission_id" UUID NOT NULL,
  "camporee_event_rubric_id" INTEGER NOT NULL,
  "awarded_points" NUMERIC(10,2) NOT NULL,
  "notes" TEXT,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT "camporee_event_score_submission_items_points_check"
    CHECK ("awarded_points" >= 0),
  CONSTRAINT "camporee_event_score_submission_items_submission_fkey"
    FOREIGN KEY ("camporee_event_score_submission_id")
    REFERENCES "camporee_event_score_submissions"("camporee_event_score_submission_id")
    ON DELETE CASCADE,
  CONSTRAINT "camporee_event_score_submission_items_rubric_fkey"
    FOREIGN KEY ("camporee_event_rubric_id")
    REFERENCES "camporee_event_rubrics"("camporee_event_rubric_id")
    ON DELETE NO ACTION
);

CREATE UNIQUE INDEX IF NOT EXISTS "uq_camporee_score_submission_item_rubric"
  ON "camporee_event_score_submission_items"(
    "camporee_event_score_submission_id",
    "camporee_event_rubric_id"
  );

CREATE TABLE IF NOT EXISTS "camporee_event_section_results" (
  "camporee_event_section_result_id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "camporee_event_id" INTEGER NOT NULL,
  "camporee_club_id" INTEGER,
  "club_section_id" INTEGER NOT NULL,
  "source_submission_id" UUID NOT NULL,
  "total_awarded_points" NUMERIC(10,2) NOT NULL,
  "total_max_points" NUMERIC(10,2) NOT NULL,
  "percentage" NUMERIC(5,2) NOT NULL,
  "finalized_by" UUID NOT NULL,
  "finalized_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "active" BOOLEAN NOT NULL DEFAULT TRUE,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "modified_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT "camporee_event_section_results_event_fkey"
    FOREIGN KEY ("camporee_event_id") REFERENCES "camporee_events"("camporee_event_id") ON DELETE CASCADE,
  CONSTRAINT "camporee_event_section_results_camporee_club_fkey"
    FOREIGN KEY ("camporee_club_id") REFERENCES "camporee_clubs"("camporee_club_id") ON DELETE SET NULL,
  CONSTRAINT "camporee_event_section_results_section_fkey"
    FOREIGN KEY ("club_section_id") REFERENCES "club_sections"("club_section_id") ON DELETE NO ACTION,
  CONSTRAINT "camporee_event_section_results_submission_fkey"
    FOREIGN KEY ("source_submission_id")
    REFERENCES "camporee_event_score_submissions"("camporee_event_score_submission_id")
    ON DELETE NO ACTION,
  CONSTRAINT "camporee_event_section_results_finalizer_fkey"
    FOREIGN KEY ("finalized_by") REFERENCES "users"("user_id") ON DELETE NO ACTION
);

CREATE UNIQUE INDEX IF NOT EXISTS "uq_camporee_event_section_results_active"
  ON "camporee_event_section_results"("camporee_event_id", "club_section_id")
  WHERE "active" = TRUE;
