-- Authoritative camporee score submissions: replay safety and adjustment audit.

ALTER TABLE "camporee_event_score_submissions"
  ADD COLUMN IF NOT EXISTS "idempotency_key" UUID,
  ADD COLUMN IF NOT EXISTS "request_hash" VARCHAR(64),
  ADD COLUMN IF NOT EXISTS "raw_awarded_points" DECIMAL(10, 2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "minimum_adjustment_points" DECIMAL(10, 2) NOT NULL DEFAULT 0;

-- Existing submissions predate raw/minimum audit fields. Preserve their
-- official total conservatively as the historical raw total; no prior minimum
-- adjustment can be reconstructed safely.
UPDATE "camporee_event_score_submissions"
SET
  "raw_awarded_points" = "total_awarded_points",
  "minimum_adjustment_points" = 0;

CREATE UNIQUE INDEX IF NOT EXISTS "uq_camporee_score_submissions_actor_idempotency_key"
  ON "camporee_event_score_submissions"("submitted_by", "idempotency_key")
  WHERE "idempotency_key" IS NOT NULL;
