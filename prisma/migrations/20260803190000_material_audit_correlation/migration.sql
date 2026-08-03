BEGIN;

ALTER TABLE material_audit_logs
  ADD COLUMN IF NOT EXISTS correlation_id UUID;

CREATE INDEX IF NOT EXISTS idx_material_audit_correlation
  ON material_audit_logs (correlation_id);

COMMIT;
