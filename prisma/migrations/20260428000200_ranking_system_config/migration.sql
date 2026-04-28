-- Migration: ranking_system_config
-- Created: 2026-04-28
-- Description: Insert system_config keys for finance_closing_deadline_day (default 5) and recalculation_enabled (kill-switch, default true).
-- NOTE: Apply manually via psql — Neon shadow DB is disabled.
INSERT INTO system_config (config_key, config_value, description, config_type) VALUES
  ('ranking.finance_closing_deadline_day', '5',
   'Day of the following month considered on-time for monthly financial closing', 'integer'),
  ('ranking.recalculation_enabled', 'true',
   'Kill-switch for extended rankings recalculation', 'boolean')
ON CONFLICT (config_key) DO NOTHING;
