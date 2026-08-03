BEGIN;
ALTER TABLE club_role_assignments ADD CONSTRAINT club_role_assignments_date_range_check CHECK (end_date IS NULL OR end_date >= start_date) NOT VALID;
CREATE INDEX club_role_assignments_effective_user_dates_idx
  ON club_role_assignments (user_id, start_date, end_date) WHERE active = TRUE AND status = 'active';
CREATE INDEX club_role_assignments_effective_section_role_dates_idx
  ON club_role_assignments (club_section_id, role_id, start_date, end_date) WHERE active = TRUE AND status = 'active';
CREATE UNIQUE INDEX classes_asset_code_key ON classes (asset_code);
CREATE OR REPLACE FUNCTION enforce_club_role_slot_limits()
RETURNS trigger AS $$
DECLARE
  v_role_name TEXT; v_max_per_section INTEGER; v_current_peak INTEGER; v_conflicting_role_ids UUID[];
BEGIN
  IF NEW.end_date IS NOT NULL AND NEW.end_date < NEW.start_date THEN RETURN NEW; END IF;
  IF NEW.active IS DISTINCT FROM TRUE OR NEW.status IS DISTINCT FROM 'active' OR NEW.club_section_id IS NULL THEN RETURN NEW; END IF;
  SELECT r.role_name, COALESCE(rsl.max_per_section, CASE r.role_name
    WHEN 'director' THEN 1 WHEN 'deputy-director' THEN 2 WHEN 'secretary' THEN 1
    WHEN 'treasurer' THEN 1 WHEN 'secretary-treasurer' THEN 1 ELSE NULL END)
  INTO v_role_name, v_max_per_section FROM roles r
  LEFT JOIN role_slot_limits rsl ON rsl.role_id = r.role_id WHERE r.role_id = NEW.role_id;
  IF v_role_name IS NULL THEN RETURN NEW; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('club_role_slot:' || NEW.club_section_id::text || ':' || NEW.role_id::text, 0));
  IF v_max_per_section IS NOT NULL THEN
    WITH ranges AS (
      SELECT GREATEST(cra.start_date, NEW.start_date) lower, LEAST(COALESCE(cra.end_date, 'infinity'::date), COALESCE(NEW.end_date, 'infinity'::date)) upper
      FROM club_role_assignments cra
      WHERE cra.club_section_id = NEW.club_section_id AND cra.role_id = NEW.role_id
        AND cra.active = TRUE AND cra.status = 'active'
        AND cra.assignment_id IS DISTINCT FROM NEW.assignment_id
        AND (cra.end_date IS NULL OR cra.end_date >= cra.start_date)
        AND cra.start_date <= COALESCE(NEW.end_date, 'infinity'::date)
        AND COALESCE(cra.end_date, 'infinity'::date) >= NEW.start_date
    ), events AS (
      SELECT lower event_date, 1 delta FROM ranges UNION ALL SELECT upper + 1, -1 FROM ranges
    ), grouped AS (SELECT event_date, SUM(delta) delta FROM events GROUP BY event_date)
    SELECT MAX(running) INTO v_current_peak FROM (SELECT SUM(delta) OVER (ORDER BY event_date) running FROM grouped) peak;
    IF COALESCE(v_current_peak, 0) >= v_max_per_section THEN
      RAISE EXCEPTION 'Maximum overlapping role assignments per section reached for role % in section %', v_role_name, NEW.club_section_id USING ERRCODE = '23514';
    END IF;
  END IF;
  IF v_role_name IN ('secretary', 'treasurer', 'secretary-treasurer') THEN
    PERFORM pg_advisory_xact_lock(hashtextextended('club_role_slot:' || NEW.club_section_id::text || ':secretary-treasurer', 0));
  END IF;
  IF v_role_name IN ('secretary', 'treasurer') THEN
    SELECT ARRAY_AGG(role_id) INTO v_conflicting_role_ids FROM roles WHERE role_name = 'secretary-treasurer' AND role_category = 'CLUB' AND active = TRUE;
  ELSIF v_role_name = 'secretary-treasurer' THEN
    SELECT ARRAY_AGG(role_id) INTO v_conflicting_role_ids FROM roles WHERE role_name IN ('secretary', 'treasurer') AND role_category = 'CLUB' AND active = TRUE;
  ELSE v_conflicting_role_ids := NULL;
  END IF;
  IF v_conflicting_role_ids IS NOT NULL AND EXISTS (
    SELECT 1 FROM club_role_assignments cra
    WHERE cra.club_section_id = NEW.club_section_id AND cra.role_id = ANY(v_conflicting_role_ids)
      AND cra.active = TRUE AND cra.status = 'active'
      AND cra.assignment_id IS DISTINCT FROM NEW.assignment_id
      AND (cra.end_date IS NULL OR cra.end_date >= cra.start_date)
      AND daterange(cra.start_date, COALESCE(cra.end_date, 'infinity'::date), '[]')
          && daterange(NEW.start_date, COALESCE(NEW.end_date, 'infinity'::date), '[]')
  ) THEN
    RAISE EXCEPTION 'Cannot assign % because it overlaps an existing secretary/treasurer role in section %', v_role_name, NEW.club_section_id USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trg_enforce_club_role_slot_limits ON club_role_assignments;
CREATE TRIGGER trg_enforce_club_role_slot_limits BEFORE INSERT OR UPDATE OF role_id, club_section_id, active, status, start_date, end_date
ON club_role_assignments FOR EACH ROW EXECUTE FUNCTION enforce_club_role_slot_limits();
COMMIT;
