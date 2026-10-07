-- =============================================================
-- CLEANUP (WRITES): end RULE 3 violators only
-- Change: club-role-guide-major-eligibility (PR6)
--
-- PREREQUISITE: the read-only audit (club-role-gm-audit.sql) was run on this
-- database AND its report was approved by the product owner (APPROVAL GATE).
--
-- Usage (nothing happens without confirm=yes AND a non-empty approved id list):
--   psql "$DATABASE_URL" -v confirm=yes \
--        -v approved_rule3_ids='<assignment_id>,<assignment_id>' \
--        -f club-role-gm-cleanup.sql
-- Required variables:
--   -v approved_rule3_ids='<uuid>,<uuid>'
--                            assignment_ids of the RULE_3 rows APPROVED in the
--                            audit report. Only rows that are BOTH in the rule-3
--                            set recomputed at run time AND in this list are
--                            ended. Empty/missing list -> abort, no changes.
--                            Approved ids that no longer violate rule 3 are
--                            reported and left untouched (drift protection).
-- Optional variables:
--   -v snap=YYYYMMDD         snapshot table suffix (default 20261006)
--   -v rehome_ids='<uuid>,<uuid>'
--                            subset of the approved ids to ALSO re-home as `member`
--                            in the club's single active GM section for the
--                            current ecclesiastical year. Default empty -> no-op.
--                            Honors the partial unique index
--                            uniq_cra_annual_member_section_year (active=true AND
--                            status IN ('active','inactive') per user, section,
--                            year): an existing inactive placeholder is
--                            REACTIVATED, an existing active row is reported as
--                            already homed; every id gets an explicit outcome.
--
-- Scope: ONLY approved, still-violating active `member` assignments in AV/CQ
-- sections held by GM-eligible people (rule 3). Rule-1 rows (service roles without GM eligibility) and
-- UNKNOWN-kind sections are NEVER touched.
-- Ending an assignment follows removeRoleAssignment(): active=false,
-- status='ended', end_date=today, modified_at=now(). Rows are never deleted.
-- Idempotent: rows already ended no longer match; the snapshot keeps the first
-- (pre-change) image of each row (ON CONFLICT DO NOTHING).
-- Everything runs in ONE transaction (all-or-nothing).
-- Eligibility / section-kind definitions: see club-role-gm-audit.sql header.
-- =============================================================

\set ON_ERROR_STOP on
\pset pager off

\if :{?confirm}
\else
  \echo 'ABORT: missing -v confirm=yes. Nothing was changed.'
  \quit
\endif

SELECT (:'confirm' = 'yes') AS confirmed \gset
\if :confirmed
\else
  \echo 'ABORT: confirm must be exactly yes. Nothing was changed.'
  \quit
\endif

\if :{?snap}
\else
  \set snap 20261006
\endif
\if :{?rehome_ids}
\else
  \set rehome_ids ''
\endif

\if :{?approved_rule3_ids}
\else
  \echo 'ABORT: missing -v approved_rule3_ids=<uuid,uuid>. Nothing was changed.'
  \quit
\endif

SELECT (cardinality(array_remove(
          string_to_array(regexp_replace(:'approved_rule3_ids', '\s', '', 'g'), ','), ''
        )) > 0) AS has_approved_ids \gset
\if :has_approved_ids
\else
  \echo 'ABORT: approved_rule3_ids is empty. Nothing was changed.'
  \quit
\endif

SELECT (:'snap' ~ '^[0-9A-Za-z_]+$') AS snap_ok \gset
\if :snap_ok
\else
  \echo 'ABORT: snap must match [0-9A-Za-z_]+. Nothing was changed.'
  \quit
\endif

\set tbl club_role_assignments_gm_cleanup_snapshot_ :snap
\set rehome_tbl club_role_assignments_gm_cleanup_snapshot_ :snap _rehome

\echo 'Target database:'
SELECT current_database() AS database, current_user AS db_user;

BEGIN;

SET LOCAL lock_timeout = '10s';
SET LOCAL statement_timeout = '120s';

-- Snapshot table: exact pre-change image of every row this script changes.
CREATE TABLE IF NOT EXISTS :"tbl" (
  LIKE club_role_assignments INCLUDING DEFAULTS,
  snapshot_at timestamptz NOT NULL DEFAULT now(),
  rehome_requested boolean NOT NULL DEFAULT false,
  PRIMARY KEY (assignment_id)
);

-- Rows created by the optional re-home block (used by restore).
CREATE TABLE IF NOT EXISTS :"rehome_tbl" (
  new_assignment_id uuid PRIMARY KEY,
  source_assignment_id uuid NOT NULL,
  kind text NOT NULL DEFAULT 'created' CHECK (kind IN ('created', 'reactivated')),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TEMP TABLE _gm_section_kinds ON COMMIT DROP AS
SELECT cs.club_section_id,
       cs.main_club_id,
       cs.active AS section_active,
       CASE
         WHEN n.v LIKE '%guia%' OR n.v LIKE '%master guide%' OR n.v LIKE '%master guild%' THEN 'GM'
         WHEN n.v LIKE '%conquistador%' OR n.v LIKE '%pathfinder%' THEN 'CQ'
         WHEN n.v LIKE '%aventurer%' OR n.v LIKE '%adventurer%' THEN 'AV'
         ELSE 'UNKNOWN'
       END AS section_kind
FROM club_sections cs
JOIN club_types ct ON ct.club_type_id = cs.club_type_id
CROSS JOIN LATERAL (
  SELECT btrim(regexp_replace(regexp_replace(
           translate(lower(ct.name), 'áéíóúüñàèìòùâêîôû', 'aeiouunaeiouaeiou'),
           '[_-]+', ' ', 'g'), '\s+', ' ', 'g')) AS v
) n;

CREATE TEMP TABLE _gm_eligible ON COMMIT DROP AS
SELECT DISTINCT e.user_id
FROM enrollments e
JOIN classes c ON c.class_id = e.class_id
WHERE c.asset_code = 'GM-01'
  AND (
    e.investiture_status::text IN ('INVESTIDO', 'APPROVED')
    OR (
      e.active
      AND c.active
      AND e.investiture_status::text IN (
        'IN_PROGRESS', 'SUBMITTED_FOR_VALIDATION', 'CLUB_APPROVED',
        'COORDINATOR_APPROVED', 'FIELD_APPROVED'
      )
    )
  );

-- Rule-3 violators: GM-eligible person with an active `member` in an AV/CQ section.
CREATE TEMP TABLE _gm_rule3 ON COMMIT DROP AS
SELECT a.assignment_id
FROM club_role_assignments a
JOIN roles r ON r.role_id = a.role_id AND r.role_name = 'member'
JOIN _gm_section_kinds sk ON sk.club_section_id = a.club_section_id
                         AND sk.section_kind IN ('AV', 'CQ')
JOIN _gm_eligible g ON g.user_id = a.user_id
WHERE a.active = true
  AND COALESCE(a.status, 'active') IN ('active', 'designated');

SELECT count(*) AS rule3_violators_found FROM _gm_rule3;

-- Approved list (explicit allowlist from the approved audit report).
CREATE TEMP TABLE _gm_approved ON COMMIT DROP AS
SELECT DISTINCT x::uuid AS assignment_id
FROM unnest(array_remove(
       string_to_array(regexp_replace(:'approved_rule3_ids', '\s', '', 'g'), ','), ''
     )) AS x;

-- Target = recomputed rule-3 set AND approved list. Nothing else is touched.
CREATE TEMP TABLE _gm_target ON COMMIT DROP AS
SELECT v.assignment_id
FROM _gm_rule3 v
JOIN _gm_approved ap ON ap.assignment_id = v.assignment_id;

\echo '=== Approved ids that no longer violate rule 3 (NOT touched) ==='
SELECT ap.assignment_id AS approved_but_not_violating
FROM _gm_approved ap
LEFT JOIN _gm_rule3 v ON v.assignment_id = ap.assignment_id
WHERE v.assignment_id IS NULL
ORDER BY ap.assignment_id;

\echo '=== Rule-3 violators NOT in the approved list (NOT touched) ==='
SELECT v.assignment_id AS violating_but_not_approved
FROM _gm_rule3 v
LEFT JOIN _gm_approved ap ON ap.assignment_id = v.assignment_id
WHERE ap.assignment_id IS NULL
ORDER BY v.assignment_id;

SELECT count(*) AS targets_to_end FROM _gm_target;

-- 1. Snapshot (first image wins on re-runs).
INSERT INTO :"tbl"
SELECT a.*, now(), false
FROM club_role_assignments a
JOIN _gm_target v ON v.assignment_id = a.assignment_id
ON CONFLICT (assignment_id) DO NOTHING;

-- 2. End ONLY approved rule-3 violators.
WITH ended AS (
  UPDATE club_role_assignments a
     SET active = false,
         status = 'ended',
         end_date = GREATEST(a.start_date, CURRENT_DATE),
         modified_at = now()
    FROM _gm_target v
   WHERE a.assignment_id = v.assignment_id
     AND a.active = true
     AND COALESCE(a.status, 'active') IN ('active', 'designated')
  RETURNING a.assignment_id
)
SELECT count(*) AS ended_rows FROM ended;

-- 3. Optional re-home (no-op when rehome_ids is empty). Only ids that were
--    just ended by this run (approved AND still violating) are eligible.
UPDATE :"tbl"
   SET rehome_requested = true
 WHERE assignment_id IN (SELECT assignment_id FROM _gm_target)
   AND assignment_id = ANY (
     array_remove(string_to_array(regexp_replace(:'rehome_ids', '\s', '', 'g'), ','), '')::uuid[]
   );

CREATE TEMP TABLE _gm_current_year ON COMMIT DROP AS
SELECT year_id
FROM ecclesiastical_years
WHERE active
ORDER BY (CURRENT_DATE BETWEEN start_date AND end_date) DESC, start_date DESC
LIMIT 1;

CREATE TEMP TABLE _gm_single_gm ON COMMIT DROP AS
SELECT main_club_id, min(club_section_id) AS gm_section_id
FROM _gm_section_kinds
WHERE section_kind = 'GM' AND section_active AND main_club_id IS NOT NULL
GROUP BY main_club_id
HAVING count(*) = 1;

-- One row per requested source assignment with an explicit outcome.
-- The conflict probe mirrors uniq_cra_annual_member_section_year
-- (active = true AND status IN ('active','inactive'), per user+section+year).
CREATE TEMP TABLE _gm_rehome_plan ON COMMIT DROP AS
SELECT s.assignment_id AS source_assignment_id,
       s.user_id,
       s.role_id,
       g.gm_section_id,
       row_number() OVER (PARTITION BY s.user_id, g.gm_section_id
                          ORDER BY s.assignment_id) AS rn,
       ex.assignment_id AS existing_assignment_id,
       ex.status AS existing_status,
       CASE
         WHEN NOT EXISTS (SELECT 1 FROM _gm_current_year) THEN 'SKIPPED_NO_CURRENT_YEAR'
         WHEN g.gm_section_id IS NULL THEN 'SKIPPED_NO_SINGLE_ACTIVE_GM_SECTION'
         ELSE NULL
       END AS pre_outcome
FROM :"tbl" s
JOIN _gm_section_kinds sk ON sk.club_section_id = s.club_section_id
LEFT JOIN _gm_single_gm g ON g.main_club_id = sk.main_club_id
LEFT JOIN LATERAL (
  SELECT x.assignment_id, x.status
  FROM club_role_assignments x
  WHERE x.user_id = s.user_id AND x.role_id = s.role_id
    AND x.club_section_id = g.gm_section_id
    AND x.active = true
    AND COALESCE(x.status, 'active') IN ('active', 'inactive', 'designated')
    AND (
      COALESCE(x.status, 'active') IN ('active', 'designated')
      OR x.ecclesiastical_year_id = (SELECT year_id FROM _gm_current_year)
    )
  ORDER BY (COALESCE(x.status, 'active') = 'inactive'), x.assignment_id
  LIMIT 1
) ex ON true
WHERE s.rehome_requested
  AND s.assignment_id IN (SELECT assignment_id FROM _gm_target);

-- Reactivate matching inactive placeholders (never silently skip).
CREATE TEMP TABLE _gm_reactivated ON COMMIT DROP AS
WITH r AS (
  UPDATE club_role_assignments a
     SET status = 'active', modified_at = now()
    FROM _gm_rehome_plan p
   WHERE p.pre_outcome IS NULL AND p.rn = 1
     AND p.existing_status = 'inactive'
     AND a.assignment_id = p.existing_assignment_id
     AND a.active = true AND a.status = 'inactive'
  RETURNING a.assignment_id, p.source_assignment_id
)
SELECT * FROM r;

INSERT INTO :"rehome_tbl" (new_assignment_id, source_assignment_id, kind)
SELECT assignment_id, source_assignment_id, 'reactivated' FROM _gm_reactivated
ON CONFLICT (new_assignment_id) DO NOTHING;

-- Insert where nothing exists yet (plain INSERT: the unique index can no longer
-- be hit silently; a real conflict aborts the whole transaction instead).
CREATE TEMP TABLE _gm_created ON COMMIT DROP AS
WITH ins AS (
  INSERT INTO club_role_assignments
    (user_id, role_id, ecclesiastical_year_id, start_date, active, status, club_section_id)
  SELECT p.user_id, p.role_id, (SELECT year_id FROM _gm_current_year), CURRENT_DATE,
         true, 'active', p.gm_section_id
  FROM _gm_rehome_plan p
  WHERE p.pre_outcome IS NULL AND p.rn = 1 AND p.existing_assignment_id IS NULL
  RETURNING assignment_id, user_id, club_section_id
)
SELECT i.assignment_id, p.source_assignment_id
FROM ins i
JOIN _gm_rehome_plan p ON p.user_id = i.user_id AND p.gm_section_id = i.club_section_id AND p.rn = 1;

INSERT INTO :"rehome_tbl" (new_assignment_id, source_assignment_id, kind)
SELECT assignment_id, source_assignment_id, 'created' FROM _gm_created;

\echo '=== Re-home report (every requested id has an outcome) ==='
SELECT p.source_assignment_id,
       CASE
         WHEN p.pre_outcome IS NOT NULL THEN p.pre_outcome
         WHEN p.rn > 1 THEN 'COVERED_BY_OTHER_SOURCE_ROW'
         WHEN rc.assignment_id IS NOT NULL THEN 'REACTIVATED'
         WHEN cr.assignment_id IS NOT NULL THEN 'REHOMED'
         WHEN p.existing_assignment_id IS NOT NULL THEN 'SKIPPED_ALREADY_ACTIVE_IN_GM'
         ELSE 'SKIPPED_UNKNOWN'
       END AS outcome,
       COALESCE(rc.assignment_id, cr.assignment_id, p.existing_assignment_id) AS target_assignment_id
FROM _gm_rehome_plan p
LEFT JOIN _gm_reactivated rc ON rc.source_assignment_id = p.source_assignment_id
LEFT JOIN _gm_created cr ON cr.source_assignment_id = p.source_assignment_id
UNION ALL
SELECT x::uuid, 'SKIPPED_NOT_APPROVED_OR_NOT_ENDED_BY_THIS_RUN', NULL
FROM unnest(array_remove(string_to_array(regexp_replace(:'rehome_ids', '\s', '', 'g'), ','), '')) x
WHERE x::uuid NOT IN (SELECT assignment_id FROM _gm_target)
ORDER BY 1;

SELECT (SELECT count(*) FROM _gm_reactivated) AS reactivated_rows,
       (SELECT count(*) FROM _gm_created) AS rehomed_rows;

SELECT count(*) AS snapshot_rows_total FROM :"tbl";

COMMIT;

\echo 'DONE. Snapshot table: ' :tbl
\echo 'Re-run club-role-gm-audit.sql: RULE_3_GM_MEMBER_IN_AV_CQ must now be 0.'
