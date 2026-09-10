-- Annual membership cycle: vacant director succession, club-year transition ledger,
-- and one equivalent member row per user/section/year (enrolled or not-enrolled).
--
-- Does not rewrite 20260908180000_director_year_slots.
-- Duplicate member groups abort the unique index instead of deleting rows.

BEGIN;

ALTER TABLE director_succession_plans
  ALTER COLUMN outgoing_assignment_id DROP NOT NULL;

CREATE TYPE club_year_transition_status_enum AS ENUM (
  'pending',
  'in_progress',
  'completed',
  'failed'
);

CREATE TABLE club_year_transitions (
  transition_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  club_id INTEGER NOT NULL REFERENCES clubs(club_id) ON DELETE RESTRICT ON UPDATE NO ACTION,
  ecclesiastical_year_id INTEGER NOT NULL REFERENCES ecclesiastical_years(year_id) ON DELETE RESTRICT ON UPDATE NO ACTION,
  status club_year_transition_status_enum NOT NULL DEFAULT 'pending',
  version INTEGER NOT NULL DEFAULT 1,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  modified_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT club_year_transitions_club_year_key UNIQUE (club_id, ecclesiastical_year_id)
);

CREATE INDEX club_year_transitions_status_year_idx
  ON club_year_transitions (status, ecclesiastical_year_id);

DO $$
DECLARE
  member_role uuid;
  dup_count integer;
BEGIN
  SELECT role_id INTO member_role
  FROM roles
  WHERE role_name = 'member'
    AND role_category = 'CLUB'
    AND active = true
  LIMIT 1;

  IF member_role IS NULL THEN
    RAISE EXCEPTION 'CLUB member role not found; cannot create uniq_cra_annual_member_section_year';
  END IF;

  SELECT count(*) INTO dup_count
  FROM (
    SELECT user_id, club_section_id, ecclesiastical_year_id
    FROM club_role_assignments
    WHERE role_id = member_role
      AND active = true
      AND status IN ('active', 'inactive')
      AND club_section_id IS NOT NULL
    GROUP BY user_id, club_section_id, ecclesiastical_year_id
    HAVING count(*) > 1
  ) duplicates;

  IF dup_count > 0 THEN
    RAISE EXCEPTION
      'uniq_cra_annual_member_section_year blocked: % duplicate member groups. Run AnnualMembershipPolicyService.reportLegacyConflicts; do not auto-delete.',
      dup_count;
  END IF;

  EXECUTE format(
    $idx$
    CREATE UNIQUE INDEX uniq_cra_annual_member_section_year
      ON club_role_assignments (user_id, club_section_id, ecclesiastical_year_id)
      WHERE active = true
        AND status IN ('active', 'inactive')
        AND role_id = %L
        AND club_section_id IS NOT NULL
    $idx$,
    member_role
  );
END $$;

COMMIT;
