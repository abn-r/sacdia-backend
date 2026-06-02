-- Enforce core club-role slot limits at the data layer.
-- This complements service-level validation and makes the canonical leadership
-- limits effective even if role-slot seed scripts were not run manually.

INSERT INTO role_slot_limits (role_id, max_per_section)
SELECT role_id, limits.max_per_section
FROM (
  VALUES
    ('director', 1),
    ('deputy-director', 2),
    ('secretary', 1),
    ('treasurer', 1),
    ('secretary-treasurer', 1)
) AS limits(role_name, max_per_section)
JOIN roles ON roles.role_name = limits.role_name
WHERE roles.role_category = 'CLUB'
ON CONFLICT (role_id) DO UPDATE
SET max_per_section = EXCLUDED.max_per_section,
    modified_at = CURRENT_TIMESTAMP;

CREATE OR REPLACE FUNCTION enforce_club_role_slot_limits()
RETURNS trigger AS $$
DECLARE
  v_role_name TEXT;
  v_max_per_section INTEGER;
  v_current_count INTEGER;
  v_conflicting_role_ids UUID[];
BEGIN
  IF NEW.active IS DISTINCT FROM TRUE OR NEW.club_section_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT
    r.role_name,
    COALESCE(
      rsl.max_per_section,
      CASE r.role_name
        WHEN 'director' THEN 1
        WHEN 'deputy-director' THEN 2
        WHEN 'secretary' THEN 1
        WHEN 'treasurer' THEN 1
        WHEN 'secretary-treasurer' THEN 1
        ELSE NULL
      END
    )
  INTO v_role_name, v_max_per_section
  FROM roles r
  LEFT JOIN role_slot_limits rsl ON rsl.role_id = r.role_id
  WHERE r.role_id = NEW.role_id;

  IF v_role_name IS NULL THEN
    RETURN NEW;
  END IF;

  -- Serialize concurrent writes for the same section+role so two requests cannot
  -- both pass the count check before either commits.
  PERFORM pg_advisory_xact_lock(
    hashtextextended(
      'club_role_slot:' || NEW.club_section_id::text || ':' || NEW.role_id::text,
      0
    )
  );

  IF v_max_per_section IS NOT NULL THEN
    SELECT COUNT(*)
    INTO v_current_count
    FROM club_role_assignments cra
    WHERE cra.club_section_id = NEW.club_section_id
      AND cra.role_id = NEW.role_id
      AND cra.active = TRUE
      AND cra.assignment_id IS DISTINCT FROM NEW.assignment_id;

    IF v_current_count >= v_max_per_section THEN
      RAISE EXCEPTION 'Maximum role assignments per section reached for role % in section %',
        v_role_name, NEW.club_section_id
        USING ERRCODE = '23514';
    END IF;
  END IF;

  IF v_role_name IN ('secretary', 'treasurer') THEN
    SELECT ARRAY_AGG(role_id)
    INTO v_conflicting_role_ids
    FROM roles
    WHERE role_name = 'secretary-treasurer'
      AND role_category = 'CLUB'
      AND active = TRUE;
  ELSIF v_role_name = 'secretary-treasurer' THEN
    SELECT ARRAY_AGG(role_id)
    INTO v_conflicting_role_ids
    FROM roles
    WHERE role_name IN ('secretary', 'treasurer')
      AND role_category = 'CLUB'
      AND active = TRUE;
  ELSE
    v_conflicting_role_ids := NULL;
  END IF;

  IF v_conflicting_role_ids IS NOT NULL
     AND EXISTS (
       SELECT 1
       FROM club_role_assignments cra
       WHERE cra.club_section_id = NEW.club_section_id
         AND cra.role_id = ANY(v_conflicting_role_ids)
         AND cra.active = TRUE
         AND cra.assignment_id IS DISTINCT FROM NEW.assignment_id
     ) THEN
    RAISE EXCEPTION 'Cannot assign % because it conflicts with an existing secretary/treasurer role in section %',
      v_role_name, NEW.club_section_id
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_enforce_club_role_slot_limits ON club_role_assignments;

CREATE TRIGGER trg_enforce_club_role_slot_limits
BEFORE INSERT OR UPDATE OF role_id, club_section_id, active ON club_role_assignments
FOR EACH ROW
EXECUTE FUNCTION enforce_club_role_slot_limits();
