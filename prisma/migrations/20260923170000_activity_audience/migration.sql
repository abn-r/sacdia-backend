-- Who an activity is for. all = every member of the participating sections.
-- board = directiva only. classes = the ids stored in activities.classes.

ALTER TABLE activities
  ADD COLUMN IF NOT EXISTS audience varchar(20) NOT NULL DEFAULT 'all';

ALTER TABLE activity_series
  ADD COLUMN IF NOT EXISTS audience varchar(20) NOT NULL DEFAULT 'all';

DO $$
BEGIN
  ALTER TABLE activities
    ADD CONSTRAINT activities_audience_check
    CHECK (audience IN ('all', 'board', 'classes'));
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE activity_series
    ADD CONSTRAINT activity_series_audience_check
    CHECK (audience IN ('all', 'board', 'classes'));
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
