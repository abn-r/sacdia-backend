-- ============================================================================
-- SACDIA System Config Seed
-- ============================================================================
-- Idempotent: uses INSERT ... ON CONFLICT DO UPDATE (upsert).
-- Run with: /opt/homebrew/opt/libpq/bin/psql "$DATABASE_URL" -f prisma/seeds/system-config.seed.sql
--
-- Depends on: system_config table (Wave 3 migration must run first)
-- ============================================================================

BEGIN;

INSERT INTO system_config (config_key, config_value, description, config_type) VALUES
  ('investiture.min_approval_percentage', '80', 'Porcentaje mínimo de requisitos aprobados para ser apto a investidura', 'int'),
  ('investiture.min_monthly_reports', '10', 'Cantidad mínima de reportes mensuales enviados para permitir investidura', 'int'),
  ('reports.auto_generate_day', '5', 'Día del mes para autogenerar reportes mensuales', 'int'),
  ('reports.auto_generate_enabled', 'true', 'Habilitar/deshabilitar autogeneración de reportes', 'boolean')
ON CONFLICT (config_key) DO UPDATE SET
  config_value = EXCLUDED.config_value,
  description = EXCLUDED.description,
  config_type = EXCLUDED.config_type;

COMMIT;

-- ============================================================================
-- Verification
-- ============================================================================
SELECT config_key, config_value, config_type, description
FROM system_config
ORDER BY config_key;
