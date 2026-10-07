-- =============================================================
-- CLEANUP (WRITES): end RULE 3 violators only
-- Change: club-role-guide-major-eligibility (PR6)
--
-- PREREQUISITE: the read-only audit (club-role-gm-audit.sql) was run on this
-- database AND its report was approved by the product owner (APPROVAL GATE).
--
-- Usage (nothing happens without confirm=yes):
--   psql "$DATABASE_URL" -v confirm=yes -f club-role-gm-cleanup.sql
-- Optional variables:
--   -v snap=YYYYMMDD         snapshot table suffix (default 20261006)
--   -v rehome_ids='<uuid>,<uuid>'
--                            assignment_ids (from the audit, RULE_3 rows) to
--                            ALSO re-home as `member` in the club's single active
--                            GM section for the current ecclesiastical year.
--                            Default empty -> re-home block is a no-op.
--
-- Scope: ONLY active `member` assignments in AV/CQ sections held by GM-eligible
-- people (rule 3). Rule-1 rows (service roles without GM eligibility) and
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

-- 1. Snapshot (first image wins on re-runs).
INSERT INTO :"tbl"
SELECT a.*, now(), false
FROM club_role_assignments a
JOIN _gm_rule3 v ON v.assignment_id = a.assignment_id
ON CONFLICT (assignment_id) DO NOTHING;

-- 2. End ONLY rule-3 violators.
WITH ended AS (
  UPDATE club_role_assignments a
     SET active = false,
         status = 'ended',
         end_date = GREATEST(a.start_date, CURRENT_DATE),
         modified_at = now()
    FROM _gm_rule3 v
   WHERE a.assignment_id = v.assignment_id
     AND a.active = true
     AND COALESCE(a.status, 'active') IN ('active', 'designated')
  RETURNING a.assignment_id
)
SELECT count(*) AS ended_rows FROM ended;

-- 3. Optional re-home (no-op when rehome_ids is empty).
--    Only snapshot rows that are RULE_3 and listed; one new `member` row per
--    (user, GM section) in the club's single active GM section, current year.
UPDATE :"tbl"
   SET rehome_requested = true
 WHERE assignment_id = ANY (array_remove(string_to_array(:'rehome_ids', ','), '')::uuid[]);

WITH current_year AS (
  SELECT year_id
  FROM ecclesiastical_years
  WHERE active
  ORDER BY (CURRENT_DATE BETWEEN start_date AND end_date) DESC, start_date DESC
  LIMIT 1
),
single_gm AS (
  SELECT main_club_id, min(club_section_id) AS gm_section_id
  FROM _gm_section_kinds
  WHERE section_kind = 'GM' AND section_active AND main_club_id IS NOT NULL
  GROUP BY main_club_id
  HAVING count(*) = 1
),
candidates AS (
  SELECT DISTINCT ON (s.user_id, g.gm_section_id)
         s.assignment_id AS source_assignment_id,
         s.user_id,
         s.role_id,
         g.gm_section_id
  FROM :"tbl" s
  JOIN _gm_section_kinds sk ON sk.club_section_id = s.club_section_id
  JOIN single_gm g ON g.main_club_id = sk.main_club_id
  WHERE s.rehome_requested
    AND NOT EXISTS (
      SELECT 1 FROM club_role_assignments x
       WHERE x.user_id = s.user_id AND x.role_id = s.role_id
         AND x.club_section_id = g.gm_section_id
         AND x.active = true AND COALESCE(x.status, 'active') IN ('active', 'designated')
    )
  ORDER BY s.user_id, g.gm_section_id, s.assignment_id
),
inserted AS (
  INSERT INTO club_role_assignments
    (user_id, role_id, ecclesiastical_year_id, start_date, active, status, club_section_id)
  SELECT c.user_id, c.role_id, (SELECT year_id FROM current_year), CURRENT_DATE,
         true, 'active', c.gm_section_id
  FROM candidates c
  WHERE EXISTS (SELECT 1 FROM current_year)
  ON CONFLICT DO NOTHING
  RETURNING assignment_id, user_id, club_section_id
),
logged AS (
  INSERT INTO :"rehome_tbl" (new_assignment_id, source_assignment_id)
  SELECT i.assignment_id, c.source_assignment_id
  FROM inserted i
  JOIN candidates c ON c.user_id = i.user_id AND c.gm_section_id = i.club_section_id
  RETURNING new_assignment_id
)
SELECT count(*) AS rehomed_rows FROM logged;

SELECT count(*) AS snapshot_rows_total FROM :"tbl";

COMMIT;

\echo 'DONE. Snapshot table: ' :tbl
\echo 'Re-run club-role-gm-audit.sql: RULE_3_GM_MEMBER_IN_AV_CQ must now be 0.'
