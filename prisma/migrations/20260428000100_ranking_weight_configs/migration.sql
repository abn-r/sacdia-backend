-- Migration: ranking_weight_configs
-- Created: 2026-04-28
-- Description: Add ranking_weight_configs table with default global seed (60/15/15/10), partial unique index for null-club_type singleton, and CHECK constraints enforcing weights_sum_100 + per-weight bounds.
-- NOTE: Apply manually via psql — Neon shadow DB is disabled.
CREATE TABLE ranking_weight_configs (
  ranking_weight_config_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  club_type_id int UNIQUE,
  folder_weight int NOT NULL,
  finance_weight int NOT NULL,
  camporee_weight int NOT NULL,
  evidence_weight int NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid,
  CONSTRAINT weights_sum_100 CHECK (
    folder_weight + finance_weight + camporee_weight + evidence_weight = 100
  ),
  CONSTRAINT weight_ranges CHECK (
    folder_weight BETWEEN 0 AND 100
    AND finance_weight BETWEEN 0 AND 100
    AND camporee_weight BETWEEN 0 AND 100
    AND evidence_weight BETWEEN 0 AND 100
  ),
  FOREIGN KEY (club_type_id) REFERENCES club_types(club_type_id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX idx_ranking_weights_default
  ON ranking_weight_configs ((club_type_id IS NULL))
  WHERE club_type_id IS NULL;

INSERT INTO ranking_weight_configs (club_type_id, folder_weight, finance_weight, camporee_weight, evidence_weight)
VALUES (NULL, 60, 15, 15, 10)
ON CONFLICT DO NOTHING;
