-- 20260428000200_ranking_system_config
INSERT INTO system_config (config_key, config_value, description, config_type) VALUES
  ('ranking.finance_closing_deadline_day', '5',
   'Day of the following month considered on-time for monthly financial closing', 'integer'),
  ('ranking.recalculation_enabled', 'true',
   'Kill-switch for extended rankings recalculation', 'boolean')
ON CONFLICT (config_key) DO NOTHING;
