BEGIN;

CREATE TYPE director_succession_status_enum AS ENUM ('scheduled', 'activated', 'blocked', 'cancelled');

CREATE TABLE director_succession_plans (
  succession_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  club_section_id INTEGER NOT NULL REFERENCES club_sections(club_section_id) ON DELETE RESTRICT,
  outgoing_assignment_id UUID NOT NULL REFERENCES club_role_assignments(assignment_id) ON DELETE RESTRICT,
  successor_user_id UUID NOT NULL REFERENCES users(user_id) ON DELETE RESTRICT,
  target_ecclesiastical_year_id INTEGER NOT NULL REFERENCES ecclesiastical_years(year_id) ON DELETE RESTRICT,
  effective_date DATE NOT NULL,
  status director_succession_status_enum NOT NULL DEFAULT 'scheduled',
  scheduled_by_id UUID NOT NULL REFERENCES users(user_id) ON DELETE RESTRICT,
  scheduled_by_role VARCHAR(64) NOT NULL, scheduled_local_field_id INTEGER NOT NULL REFERENCES local_fields(local_field_id) ON DELETE RESTRICT,
  scheduled_at TIMESTAMPTZ NOT NULL DEFAULT now(), idempotency_key VARCHAR(128) NOT NULL, request_hash CHAR(64) NOT NULL,
  activated_assignment_id UUID UNIQUE REFERENCES club_role_assignments(assignment_id) ON DELETE RESTRICT,
  activated_at TIMESTAMPTZ, blocked_at TIMESTAMPTZ, block_code VARCHAR(96), processing_token UUID,
  processing_expires_at TIMESTAMPTZ, attempt_count INTEGER NOT NULL DEFAULT 0, last_attempt_at TIMESTAMPTZ,
  version INTEGER NOT NULL DEFAULT 1, created_at TIMESTAMPTZ NOT NULL DEFAULT now(), modified_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT director_succession_plans_section_year_key UNIQUE (club_section_id, target_ecclesiastical_year_id),
  CONSTRAINT director_succession_plans_actor_key UNIQUE (scheduled_by_id, idempotency_key),
  CONSTRAINT director_succession_plans_status_check CHECK (
    (status = 'scheduled' AND activated_assignment_id IS NULL AND activated_at IS NULL AND blocked_at IS NULL AND block_code IS NULL) OR
    (status = 'activated' AND activated_assignment_id IS NOT NULL AND activated_at IS NOT NULL AND blocked_at IS NULL AND block_code IS NULL) OR
    (status = 'blocked' AND activated_assignment_id IS NULL AND activated_at IS NULL AND blocked_at IS NOT NULL AND block_code IS NOT NULL) OR
    (status = 'cancelled' AND activated_assignment_id IS NULL AND activated_at IS NULL AND blocked_at IS NULL AND block_code IS NULL)
  )
);
CREATE INDEX director_succession_plans_status_effective_idx ON director_succession_plans (status, effective_date, processing_expires_at);
CREATE INDEX director_succession_plans_successor_idx ON director_succession_plans (successor_user_id);
CREATE INDEX director_succession_plans_outgoing_idx ON director_succession_plans (outgoing_assignment_id);
CREATE INDEX director_succession_plans_local_field_idx ON director_succession_plans (scheduled_local_field_id);

CREATE FUNCTION set_director_succession_effective_date() RETURNS trigger AS $$
BEGIN
  SELECT start_date INTO NEW.effective_date FROM ecclesiastical_years WHERE year_id = NEW.target_ecclesiastical_year_id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER trg_set_director_succession_effective_date BEFORE INSERT OR UPDATE OF target_ecclesiastical_year_id, effective_date ON director_succession_plans FOR EACH ROW EXECUTE FUNCTION set_director_succession_effective_date();

CREATE FUNCTION prevent_scheduled_succession_year_start_date_change() RETURNS trigger AS $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM director_succession_plans
    WHERE target_ecclesiastical_year_id = OLD.year_id
      AND status = 'scheduled'
  ) THEN
    RAISE EXCEPTION 'Cannot change an ecclesiastical year start date with a scheduled director succession plan'
      USING ERRCODE = '23514',
        CONSTRAINT = 'director_succession_plans_scheduled_year_start_date_lock';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER trg_prevent_scheduled_succession_year_start_date_change
  BEFORE UPDATE OF start_date ON ecclesiastical_years
  FOR EACH ROW
  WHEN (OLD.start_date IS DISTINCT FROM NEW.start_date)
  EXECUTE FUNCTION prevent_scheduled_succession_year_start_date_change();

COMMIT;
