BEGIN;

ALTER TABLE material_categories ADD COLUMN IF NOT EXISTS local_field_id INT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'material_categories'::regclass
      AND conname = 'material_categories_local_field_id_fkey'
  ) THEN
    ALTER TABLE material_categories
      ADD CONSTRAINT material_categories_local_field_id_fkey
      FOREIGN KEY (local_field_id) REFERENCES local_fields (local_field_id)
      ON DELETE RESTRICT ON UPDATE NO ACTION;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_material_categories_lf_active
  ON material_categories (local_field_id, active);

CREATE TABLE IF NOT EXISTS material_audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  local_field_id INT NOT NULL REFERENCES local_fields (local_field_id) ON DELETE RESTRICT ON UPDATE NO ACTION,
  actor_user_id UUID NOT NULL REFERENCES users (user_id) ON DELETE RESTRICT ON UPDATE NO ACTION,
  entity_type VARCHAR(64) NOT NULL,
  entity_id VARCHAR(64) NOT NULL,
  action VARCHAR(96) NOT NULL,
  before_json JSONB,
  after_json JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_material_audit_lf_created
  ON material_audit_logs (local_field_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_material_audit_entity_created
  ON material_audit_logs (entity_type, entity_id, created_at DESC);

COMMIT;
