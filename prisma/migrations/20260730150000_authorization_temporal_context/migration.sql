-- Additive P0 authorization context foundation. Existing active local fields are
-- intentionally left unvalidated until the controlled T03 backfill completes.
ALTER TABLE local_fields
  ADD COLUMN IF NOT EXISTS timezone VARCHAR(64);

ALTER TABLE local_fields
  ADD CONSTRAINT local_fields_active_timezone_required
  CHECK (NOT active OR (timezone IS NOT NULL AND btrim(timezone) <> '')) NOT VALID;

CREATE TABLE IF NOT EXISTS authorization_context_versions (
  user_id UUID PRIMARY KEY REFERENCES users(user_id) ON DELETE CASCADE,
  version BIGINT NOT NULL DEFAULT 0,
  modified_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
