-- Scoring categories now support numeric and all-or-nothing capture modes.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'scoring_mode_enum') THEN
    CREATE TYPE scoring_mode_enum AS ENUM ('numeric', 'boolean_full');
  END IF;
END $$;

ALTER TABLE scoring_categories
  ADD COLUMN IF NOT EXISTS scoring_mode scoring_mode_enum NOT NULL DEFAULT 'numeric';

-- Weekly records become unit-attributed for new records while preserving
-- legacy rows with NULL unit_id for read fallback.
ALTER TABLE weekly_records
  ADD COLUMN IF NOT EXISTS unit_id INTEGER;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'weekly_records_unit_id_fkey'
  ) THEN
    ALTER TABLE weekly_records
      ADD CONSTRAINT weekly_records_unit_id_fkey
      FOREIGN KEY (unit_id) REFERENCES units(unit_id)
      ON DELETE NO ACTION ON UPDATE NO ACTION;
  END IF;
END $$;

ALTER TABLE weekly_records
  DROP CONSTRAINT IF EXISTS weekly_records_user_id_week_year_key;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'weekly_records_unit_id_user_id_week_year_key'
  ) THEN
    ALTER TABLE weekly_records
      ADD CONSTRAINT weekly_records_unit_id_user_id_week_year_key
      UNIQUE (unit_id, user_id, week, year);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_weekly_records_unit_id
  ON weekly_records(unit_id);
