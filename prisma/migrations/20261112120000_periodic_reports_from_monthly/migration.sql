-- Quarterly and annual reports are computed from the submitted monthly reports
-- and frozen by a daily cron once the period is past its grace window.
--   * both auto-generation flags go live (they were dark-launched as 'false');
--   * reports.periodic_freeze_grace_days: days after the period ends before the
--     report freezes, so the last monthly report can still be submitted.
-- Re-runnable: every statement is idempotent.

INSERT INTO "system_config" ("config_key", "config_value", "description", "config_type")
VALUES
  ('reports.quarterly_auto_generate_enabled', 'true', 'Enable quarterly reports auto-generation cron job', 'boolean'),
  ('reports.annual_auto_generate_enabled',    'true', 'Enable annual reports auto-generation cron job',    'boolean')
ON CONFLICT ("config_key") DO UPDATE SET
  "config_value" = EXCLUDED."config_value",
  "updated_at"   = now();

-- Never overwrites a value an admin already tuned.
INSERT INTO "system_config" ("config_key", "config_value", "description", "config_type")
VALUES
  ('reports.periodic_freeze_grace_days', '15', 'Days after a quarter or ecclesiastical year ends before its report is frozen (finalized)', 'int')
ON CONFLICT ("config_key") DO NOTHING;
