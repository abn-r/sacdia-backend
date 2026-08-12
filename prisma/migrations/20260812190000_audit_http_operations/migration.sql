BEGIN;

ALTER TABLE audit_logs
  ADD COLUMN source VARCHAR(24) NOT NULL DEFAULT 'service',
  ADD COLUMN request_context JSONB;

-- Retention purges and time-range queries scan by created_at alone.
CREATE INDEX idx_audit_logs_created
  ON audit_logs (created_at);

COMMIT;
