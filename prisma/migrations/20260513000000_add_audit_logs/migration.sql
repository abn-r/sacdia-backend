-- CreateTable: audit_logs
CREATE TABLE audit_logs (
  audit_log_id BIGSERIAL PRIMARY KEY,
  entity_type  VARCHAR(50) NOT NULL,
  entity_id    VARCHAR(64) NOT NULL,
  action       VARCHAR(20) NOT NULL CHECK (action IN ('CREATED','UPDATED','DELETED')),
  club_id      INT NULL REFERENCES clubs(club_id) ON DELETE SET NULL,
  actor_user_id UUID NULL,
  summary      VARCHAR(500) NULL,
  changes      JSONB NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_audit_logs_club_created ON audit_logs (club_id, created_at DESC);
CREATE INDEX idx_audit_logs_entity ON audit_logs (entity_type, entity_id);
