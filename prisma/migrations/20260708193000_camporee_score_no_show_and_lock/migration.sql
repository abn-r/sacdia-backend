-- Camporee scoring no-show state, minimum-point clamp audit, and override chain.

ALTER TABLE "camporee_event_score_submissions"
  ADD COLUMN IF NOT EXISTS "score_status" VARCHAR(20) NOT NULL DEFAULT 'scored',
  ADD COLUMN IF NOT EXISTS "is_no_show" BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS "override_of_submission_id" UUID;

ALTER TABLE "camporee_event_section_results"
  ADD COLUMN IF NOT EXISTS "score_status" VARCHAR(20) NOT NULL DEFAULT 'scored',
  ADD COLUMN IF NOT EXISTS "is_no_show" BOOLEAN NOT NULL DEFAULT FALSE;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'camporee_event_score_submissions_score_status_check'
  ) THEN
    ALTER TABLE "camporee_event_score_submissions"
      ADD CONSTRAINT "camporee_event_score_submissions_score_status_check"
      CHECK ("score_status" IN ('scored', 'no_show'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'camporee_event_score_submissions_no_show_consistency_check'
  ) THEN
    ALTER TABLE "camporee_event_score_submissions"
      ADD CONSTRAINT "camporee_event_score_submissions_no_show_consistency_check"
      CHECK (("score_status" = 'no_show') = "is_no_show");
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'camporee_event_score_submissions_override_fkey'
  ) THEN
    ALTER TABLE "camporee_event_score_submissions"
      ADD CONSTRAINT "camporee_event_score_submissions_override_fkey"
      FOREIGN KEY ("override_of_submission_id")
      REFERENCES "camporee_event_score_submissions"("camporee_event_score_submission_id")
      ON DELETE SET NULL
      ON UPDATE NO ACTION;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'camporee_event_section_results_score_status_check'
  ) THEN
    ALTER TABLE "camporee_event_section_results"
      ADD CONSTRAINT "camporee_event_section_results_score_status_check"
      CHECK ("score_status" IN ('scored', 'no_show'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'camporee_event_section_results_no_show_consistency_check'
  ) THEN
    ALTER TABLE "camporee_event_section_results"
      ADD CONSTRAINT "camporee_event_section_results_no_show_consistency_check"
      CHECK (("score_status" = 'no_show') = "is_no_show");
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "idx_camporee_event_score_submissions_score_status"
  ON "camporee_event_score_submissions"("score_status");

CREATE INDEX IF NOT EXISTS "idx_camporee_event_score_submissions_override_of"
  ON "camporee_event_score_submissions"("override_of_submission_id");

CREATE INDEX IF NOT EXISTS "idx_camporee_event_section_results_active_status"
  ON "camporee_event_section_results"(
    "camporee_event_id",
    "club_section_id",
    "active",
    "score_status"
  );
