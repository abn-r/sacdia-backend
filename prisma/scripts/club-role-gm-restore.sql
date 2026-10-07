-- =============================================================
-- RESTORE: roll back club-role-gm-cleanup.sql from its snapshot table
-- Change: club-role-guide-major-eligibility (PR6)
--
-- Usage:
--   psql "$DATABASE_URL" -v confirm=yes [-v snap=YYYYMMDD] -f club-role-gm-restore.sql
-- snap must match the value used by the cleanup run (default 20261006).
--
-- Restores active/status/end_date/expires_at/rejection_reason/modified_at of every
-- snapshotted assignment to its pre-cleanup value. Rows created by the optional
-- re-home block are ENDED (status 'ended'), never deleted. Single transaction.
-- The snapshot tables are kept (drop them manually once no longer needed).
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

SELECT (:'snap' ~ '^[0-9A-Za-z_]+$') AS snap_ok \gset
\if :snap_ok
\else
  \echo 'ABORT: snap must match [0-9A-Za-z_]+. Nothing was changed.'
  \quit
\endif

\set tbl club_role_assignments_gm_cleanup_snapshot_ :snap
\set rehome_tbl club_role_assignments_gm_cleanup_snapshot_ :snap _rehome

SELECT current_database() AS database, current_user AS db_user;

BEGIN;

SET LOCAL lock_timeout = '10s';
SET LOCAL statement_timeout = '120s';

-- 1. End rows created by the re-home block (if any).
WITH ended AS (
  UPDATE club_role_assignments a
     SET active = false,
         status = 'ended',
         end_date = GREATEST(a.start_date, CURRENT_DATE),
         modified_at = now()
    FROM :"rehome_tbl" r
   WHERE a.assignment_id = r.new_assignment_id
     AND a.active = true
  RETURNING a.assignment_id
)
SELECT count(*) AS rehomed_rows_ended FROM ended;

-- 2. Restore the pre-cleanup state of every snapshotted row.
WITH restored AS (
  UPDATE club_role_assignments a
     SET active = s.active,
         status = s.status,
         end_date = s.end_date,
         expires_at = s.expires_at,
         rejection_reason = s.rejection_reason,
         modified_at = now()
    FROM :"tbl" s
   WHERE a.assignment_id = s.assignment_id
  RETURNING a.assignment_id
)
SELECT count(*) AS restored_rows FROM restored;

COMMIT;

\echo 'DONE. Re-run club-role-gm-audit.sql to confirm the state.'
