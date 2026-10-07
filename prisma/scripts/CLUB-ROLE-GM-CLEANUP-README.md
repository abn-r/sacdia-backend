# Club role / Guia Mayor cleanup runbook

Change: `club-role-guide-major-eligibility` (PR6). Manual psql scripts, NOT Prisma
migrations (the shadow DB is unusable here, see the project's Neon migration workflow).

| Script | Writes? | Purpose |
|---|---|---|
| `club-role-gm-audit.sql` | No (`BEGIN READ ONLY` ... `ROLLBACK`) | Lists violators and counts per category |
| `club-role-gm-cleanup.sql` | Yes, one transaction | Snapshots then ends rule-3 violators; optional re-home |
| `club-role-gm-restore.sql` | Yes, one transaction | Restores rows from the snapshot table |

## Audit categories

- `RULE_3_GM_MEMBER_IN_AV_CQ`: GM-eligible person with an active `member` in an AV/CQ section. Auto-ended by cleanup after approval.
- `RULE_1_MANUAL_REVIEW`: active service role (non-`member`) held by someone without GM eligibility. Long-tenured staff may lack GM-01 records. NEVER auto-ended: review each row by hand (fix the enrollment data or end the assignment through the app).
- `UNKNOWN_SECTION_KIND`: section whose club type name is not AV/CQ/GM. Informational; fix the catalog name if any appear.
- `NO_SECTION`: active assignment with NULL `club_section_id`; cannot be classified by section. Informational / manual review.

Each detail row also carries `has_enrollment_history` (any GM-01 enrollment, any status), `gm_enrollment_statuses`, `classification` (`rule-3`, `rule-1`, `rule-1-no-history`, `unknown-section`, `no-section`), `proposed_action` and `snapshot_modified_at`. `rule-1-no-history` is typically long-tenured legacy staff and is always manual review.

GM eligibility and section kind match `ClubRoleEligibilityService` and `src/clubs/section-display.ts` exactly (definitions in the audit header).

## Order of operations

Run each step on `development`, then `staging`, then `production`. Never skip an environment.

1. Get the branch connection string (project Neon branches workflow: `neonctl connection-string <branch>`; branches `development`, `staging`, `production`). Never commit or paste it. Export it as `DATABASE_URL` in your shell only.
2. Audit: `psql "$DATABASE_URL" -f prisma/scripts/club-role-gm-audit.sql > audit-<env>.txt`
3. APPROVAL GATE: the product owner must review and approve the audit report for that environment (rule-3 list, rule-1 manual-review list). Do not continue without explicit approval. Decide which rule-3 rows (if any) get re-homed.
4. Backup/branch point: take a Neon branch/restore point before touching staging and production.
5. Cleanup: `psql "$DATABASE_URL" -v confirm=yes -v approved_rule3_ids='<id>,<id>' -f prisma/scripts/club-role-gm-cleanup.sql`
   - Without `-v confirm=yes` the script aborts before touching anything. `approved_rule3_ids` is REQUIRED: the explicit list of RULE_3 `assignment_id`s approved in step 3. An empty or missing list aborts with no changes.
   - Only rows that are BOTH in the rule-3 set recomputed at run time AND in the approved list are ended. The script prints approved ids that no longer violate (left untouched) and violators that were not approved (left untouched), so drift since the audit never ends unapproved rows.
   - Optional re-home: add `-v rehome_ids='<assignment_id>,<assignment_id>'` (subset of the approved ids). Default empty means no re-home. Needs exactly one active GM section in the club and an active ecclesiastical year. It honors the partial unique index `uniq_cra_annual_member_section_year` (`active=true AND status IN ('active','inactive')` per user, section and year): an existing inactive placeholder is REACTIVATED, an existing active member row is reported as already homed. The script prints a per-id outcome (`REHOMED`, `REACTIVATED`, `SKIPPED_ALREADY_ACTIVE_IN_GM`, `SKIPPED_NO_SINGLE_ACTIVE_GM_SECTION`, `SKIPPED_NO_CURRENT_YEAR`, `COVERED_BY_OTHER_SOURCE_ROW`, `SKIPPED_NOT_APPROVED_OR_NOT_ENDED_BY_THIS_RUN`); nothing is skipped silently.
   - Optional `-v snap=YYYYMMDD` to name the snapshot table (default `20261006`).
6. Re-run the audit: `RULE_3_GM_MEMBER_IN_AV_CQ` must be 0. Resolve rule-1 rows manually.
7. Move to the next environment.

## Rollback

`psql "$DATABASE_URL" -v confirm=yes [-v snap=YYYYMMDD] -f prisma/scripts/club-role-gm-restore.sql`

Restores only snapshotted rows that are STILL in the exact state cleanup left them (`active=false`, `status='ended'`, `end_date` = cleanup date, `modified_at` = snapshot time); rows edited since are skipped and listed. Re-homed rows are ended, reactivated placeholders go back to `inactive` (never deletes). Snapshot tables `club_role_assignments_gm_cleanup_snapshot_<snap>` and `..._rehome` are kept; drop them manually when no longer needed.

## Notes

- "Ended" follows `removeRoleAssignment()`: `active=false`, `status='ended'`, `end_date=today`. No hard deletes.
- Idempotent: re-running cleanup finds no violators and keeps the original snapshot.
- Do not run these scripts from CI or from an agent without the approval gate.
