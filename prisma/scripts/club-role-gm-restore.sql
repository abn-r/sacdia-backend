-- =============================================================
-- RESTORE: roll back club-role-gm-cleanup.sql from its snapshot table
-- Change: club-role-guide-major-eligibility (PR6)
--
-- Usage:
--   psql "$DATABASE_URL" -v confirm=yes [-v snap=YYYYMMDD] -f club-role-gm-restore.sql
-- snap must match the value used by the cleanup run (default 20261006).
--
-- Restores active/status/end_date/expires_at/rejection_reason/modified_at of every
-- snapshotted assignment that is STILL in the exact state the cleanup left it
-- (active=false, status='ended', end_date=cleanup date, modified_at=snapshot_at);
-- other rows are skipped and listed. Rows created by the optional
-- re-home block are ENDED, rows it reactivated go back to 'inactive'; never deleted. Single transaction.
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

-- Guard: a snapshot row is restored ONLY if it is still exactly in the state the
-- cleanup left it: active=false, status='ended', end_date = cleanup date and
-- modified_at = snapshot_at (cleanup sets modified_at = now() in the same tx as
-- the snapshot). Rows edited since are skipped and reported, never clobbered.
CREATE TEMP TABLE _gm_restore_plan ON COMMIT DROP AS
SELECT s.assignment_id,
       (a.assignment_id IS NOT NULL
        AND a.active = false
        AND a.status = 'ended'
        AND a.end_date = GREATEST(s.start_date, s.snapshot_at::date)
        AND a.modified_at = s.snapshot_at) AS still_cleanup_state
FROM :"tbl" s
LEFT JOIN club_role_assignments a ON a.assignment_id = s.assignment_id;

-- 1. Undo rows created/reactivated by the optional re-home block.
--    created     -> ended (never deleted), only if still active
--    reactivated -> back to status 'inactive', only if still active/'active'
WITH ended AS (
  UPDATE club_role_assignments a
     SET active = false,
         status = 'ended',
         end_date = GREATEST(a.start_date, CURRENT_DATE),
         modified_at = now()
    FROM :"rehome_tbl" r
   WHERE a.assignment_id = r.new_assignment_id
     AND r.kind = 'created'
     AND a.active = true
  RETURNING a.assignment_id
)
SELECT count(*) AS rehomed_rows_ended FROM ended;

WITH back AS (
  UPDATE club_role_assignments a
     SET status = 'inactive', modified_at = now()
    FROM :"rehome_tbl" r
   WHERE a.assignment_id = r.new_assignment_id
     AND r.kind = 'reactivated'
     AND a.active = true AND a.status = 'active'
  RETURNING a.assignment_id
)
SELECT count(*) AS reactivated_rows_reverted FROM back;

-- 2. Restore the pre-cleanup state of every snapshotted row still in cleanup state.
WITH restored AS (
  UPDATE club_role_assignments a
     SET active = s.active,
         status = s.status,
         end_date = s.end_date,
         expires_at = s.expires_at,
         rejection_reason = s.rejection_reason,
         modified_at = now()
    FROM :"tbl" s
    JOIN _gm_restore_plan p ON p.assignment_id = s.assignment_id AND p.still_cleanup_state
   WHERE a.assignment_id = s.assignment_id
  RETURNING a.assignment_id
)
SELECT count(*) AS restored_rows FROM restored;

\echo '=== Snapshot rows SKIPPED (changed since cleanup or missing; NOT restored) ==='
SELECT p.assignment_id AS skipped_assignment_id
FROM _gm_restore_plan p
WHERE NOT p.still_cleanup_state
ORDER BY p.assignment_id;

COMMIT;

\echo 'DONE. Re-run club-role-gm-audit.sql to confirm the state.'
