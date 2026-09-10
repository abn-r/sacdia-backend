-- Director succession: allow rescheduling after cancel.
-- Replaces the full unique (club_section_id, target_ecclesiastical_year_id)
-- with a partial unique on open plans only.
-- Does not rewrite 20260908180000_director_year_slots.

BEGIN;

ALTER TABLE director_succession_plans
  DROP CONSTRAINT IF EXISTS director_succession_plans_section_year_key;

DROP INDEX IF EXISTS director_succession_plans_section_year_key;

CREATE UNIQUE INDEX uniq_director_succession_open_section_year
  ON director_succession_plans (club_section_id, target_ecclesiastical_year_id)
  WHERE status IN ('scheduled', 'activated', 'blocked');

CREATE INDEX director_succession_plans_section_year_idx
  ON director_succession_plans (club_section_id, target_ecclesiastical_year_id);

COMMIT;
