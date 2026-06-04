-- Add global scoring category max-points cap config and normalize existing outliers.

BEGIN;

INSERT INTO system_config (config_key, config_value, description, config_type)
VALUES (
  'scoring.category_max_points_cap',
  '20',
  'Cap global de puntos máximos permitido por categoría de scoring',
  'number'
)
ON CONFLICT (config_key) DO UPDATE
SET
  config_value = EXCLUDED.config_value,
  description = EXCLUDED.description,
  config_type = EXCLUDED.config_type;

UPDATE scoring_categories
SET
  max_points = 20,
  modified_at = NOW()
WHERE max_points > 20;

COMMIT;
