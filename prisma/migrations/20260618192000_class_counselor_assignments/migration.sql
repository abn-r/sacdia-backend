-- Class counselor assignments: pedagogical class ownership per section/year.
-- This is intentionally separate from club_role_assignments, which models
-- operational role membership in a section.

CREATE TABLE IF NOT EXISTS class_counselor_assignments (
  assignment_id UUID PRIMARY KEY DEFAULT extensions.uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  club_section_id INTEGER NOT NULL REFERENCES club_sections(club_section_id) ON DELETE CASCADE,
  class_id INTEGER NOT NULL REFERENCES classes(class_id) ON DELETE CASCADE,
  ecclesiastical_year_id INTEGER NOT NULL REFERENCES ecclesiastical_years(year_id) ON DELETE CASCADE,
  club_role_assignment_id UUID REFERENCES club_role_assignments(assignment_id) ON DELETE SET NULL,
  responsibility_type VARCHAR(20) NOT NULL DEFAULT 'primary',
  active BOOLEAN NOT NULL DEFAULT TRUE,
  exceptional BOOLEAN NOT NULL DEFAULT FALSE,
  exception_reason VARCHAR(500),
  assigned_by_id UUID REFERENCES users(user_id) ON DELETE NO ACTION,
  start_date DATE NOT NULL DEFAULT CURRENT_DATE,
  end_date DATE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  modified_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT class_counselor_responsibility_type_chk
    CHECK (responsibility_type IN ('primary', 'assistant', 'substitute')),
  CONSTRAINT class_counselor_exception_reason_chk
    CHECK (
      exceptional = FALSE
      OR (exception_reason IS NOT NULL AND btrim(exception_reason) <> '')
    )
);

CREATE INDEX IF NOT EXISTS idx_class_counselor_user_active_year
  ON class_counselor_assignments(user_id, active, ecclesiastical_year_id);

CREATE INDEX IF NOT EXISTS idx_class_counselor_section_class_active_year
  ON class_counselor_assignments(club_section_id, class_id, active, ecclesiastical_year_id);

CREATE INDEX IF NOT EXISTS idx_class_counselor_role_assignment
  ON class_counselor_assignments(club_role_assignment_id);

CREATE INDEX IF NOT EXISTS idx_class_counselor_assigned_by
  ON class_counselor_assignments(assigned_by_id);

CREATE UNIQUE INDEX IF NOT EXISTS uq_class_counselor_active_user_class
  ON class_counselor_assignments(user_id, club_section_id, class_id, ecclesiastical_year_id)
  WHERE active = TRUE;

CREATE UNIQUE INDEX IF NOT EXISTS uq_class_counselor_active_primary
  ON class_counselor_assignments(club_section_id, class_id, ecclesiastical_year_id)
  WHERE active = TRUE AND responsibility_type = 'primary';

CREATE OR REPLACE FUNCTION enforce_class_counselor_assignment_limits()
RETURNS trigger AS $$
DECLARE
  v_section_club_type_id INTEGER;
  v_class_club_type_id INTEGER;
  v_role_assignment_id UUID;
  v_role_name TEXT;
  v_class_assignment_count INTEGER;
  v_user_assignment_count INTEGER;
BEGIN
  IF NEW.active IS DISTINCT FROM TRUE THEN
    RETURN NEW;
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtextextended(
      'class_counselor:' || NEW.club_section_id::text || ':' ||
      NEW.class_id::text || ':' || NEW.ecclesiastical_year_id::text,
      0
    )
  );

  SELECT club_type_id
  INTO v_section_club_type_id
  FROM club_sections
  WHERE club_section_id = NEW.club_section_id
    AND active = TRUE;

  SELECT club_type_id
  INTO v_class_club_type_id
  FROM classes
  WHERE class_id = NEW.class_id
    AND active = TRUE;

  IF v_section_club_type_id IS NULL OR v_class_club_type_id IS NULL THEN
    RAISE EXCEPTION 'Invalid active section or class for class counselor assignment'
      USING ERRCODE = '23514';
  END IF;

  IF v_section_club_type_id <> v_class_club_type_id THEN
    RAISE EXCEPTION 'Class does not belong to the club type of the section'
      USING ERRCODE = '23514';
  END IF;

  SELECT cra.assignment_id, r.role_name
  INTO v_role_assignment_id, v_role_name
  FROM club_role_assignments cra
  JOIN roles r ON r.role_id = cra.role_id
  WHERE cra.user_id = NEW.user_id
    AND cra.club_section_id = NEW.club_section_id
    AND cra.ecclesiastical_year_id = NEW.ecclesiastical_year_id
    AND cra.active = TRUE
    AND (NEW.club_role_assignment_id IS NULL OR cra.assignment_id = NEW.club_role_assignment_id)
  ORDER BY cra.start_date DESC
  LIMIT 1;

  IF v_role_name IS NULL OR v_role_name NOT IN ('counselor', 'secretary') THEN
    RAISE EXCEPTION 'Only counselor or secretary can be assigned as formal class owner'
      USING ERRCODE = '23514';
  END IF;

  IF NEW.club_role_assignment_id IS NULL THEN
    NEW.club_role_assignment_id := v_role_assignment_id;
  END IF;

  SELECT COUNT(*)
  INTO v_class_assignment_count
  FROM class_counselor_assignments cca
  WHERE cca.club_section_id = NEW.club_section_id
    AND cca.class_id = NEW.class_id
    AND cca.ecclesiastical_year_id = NEW.ecclesiastical_year_id
    AND cca.active = TRUE
    AND cca.assignment_id IS DISTINCT FROM NEW.assignment_id;

  IF v_class_assignment_count >= 3 THEN
    RAISE EXCEPTION 'Class already has the maximum of 3 active responsible people'
      USING ERRCODE = '23514';
  END IF;

  SELECT COUNT(*)
  INTO v_user_assignment_count
  FROM class_counselor_assignments cca
  WHERE cca.user_id = NEW.user_id
    AND cca.club_section_id = NEW.club_section_id
    AND cca.ecclesiastical_year_id = NEW.ecclesiastical_year_id
    AND cca.active = TRUE
    AND cca.assignment_id IS DISTINCT FROM NEW.assignment_id;

  IF v_user_assignment_count >= 2 THEN
    RAISE EXCEPTION 'User already has the maximum of 2 active class assignments'
      USING ERRCODE = '23514';
  END IF;

  IF v_user_assignment_count >= 1
     AND (
       NEW.exceptional IS DISTINCT FROM TRUE
       OR NEW.exception_reason IS NULL
       OR btrim(NEW.exception_reason) = ''
     ) THEN
    RAISE EXCEPTION 'Second active class assignment requires an exception reason'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_enforce_class_counselor_assignment_limits
  ON class_counselor_assignments;

CREATE TRIGGER trg_enforce_class_counselor_assignment_limits
BEFORE INSERT OR UPDATE OF
  user_id,
  club_section_id,
  class_id,
  ecclesiastical_year_id,
  club_role_assignment_id,
  responsibility_type,
  active,
  exceptional,
  exception_reason
ON class_counselor_assignments
FOR EACH ROW
EXECUTE FUNCTION enforce_class_counselor_assignment_limits();
