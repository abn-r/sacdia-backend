-- CreateTable: cron_alerts_log
-- Stores deduplication records and alert history for automated cron job alerting.
-- No foreign keys: cron_run_log uses integer PKs and we reference by job_name string
-- to keep this table decoupled from run lifecycle.

CREATE TABLE cron_alerts_log (
  id            SERIAL PRIMARY KEY,
  job_name      VARCHAR(100)  NOT NULL,
  condition     VARCHAR(50)   NOT NULL,  -- 'consecutive_failures' | 'duration' | 'failure_rate'
  details       JSONB,
  alerted_at    TIMESTAMPTZ   NOT NULL DEFAULT now(),
  resolved_at   TIMESTAMPTZ   NULL
);

CREATE INDEX cron_alerts_log_job_name_idx  ON cron_alerts_log (job_name);
CREATE INDEX cron_alerts_log_alerted_at_idx ON cron_alerts_log (alerted_at DESC);
CREATE INDEX cron_alerts_log_unresolved_idx ON cron_alerts_log (job_name, condition) WHERE resolved_at IS NULL;
