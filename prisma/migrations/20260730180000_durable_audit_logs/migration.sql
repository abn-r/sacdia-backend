BEGIN;

ALTER TABLE audit_logs
  DROP CONSTRAINT IF EXISTS audit_logs_action_check,
  ALTER COLUMN action TYPE VARCHAR(64),
  ADD COLUMN event_key VARCHAR(160),
  ADD COLUMN actor_kind VARCHAR(24) NOT NULL DEFAULT 'user',
  ADD COLUMN actor_role_name VARCHAR(64),
  ADD COLUMN actor_scope JSONB,
  ADD COLUMN target_user_id UUID,
  ADD COLUMN target_scope JSONB,
  ADD COLUMN effective_at TIMESTAMPTZ,
  ADD COLUMN correlation_id UUID,
  ADD COLUMN idempotency_key VARCHAR(128),
  ADD COLUMN result VARCHAR(32) NOT NULL DEFAULT 'succeeded',
  ADD CONSTRAINT audit_logs_event_key_key UNIQUE (event_key);

CREATE INDEX idx_audit_logs_actor_created
  ON audit_logs (actor_user_id, created_at DESC);

CREATE INDEX idx_audit_logs_target_created
  ON audit_logs (target_user_id, created_at DESC);

CREATE INDEX idx_audit_logs_action_created
  ON audit_logs (action, created_at DESC);

CREATE INDEX idx_audit_logs_correlation_id
  ON audit_logs (correlation_id);

COMMIT;
