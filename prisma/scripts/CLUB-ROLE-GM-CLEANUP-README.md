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

GM eligibility and section kind match `ClubRoleEligibilityService` and `src/clubs/section-display.ts` exactly (definitions in the audit header).

## Order of operations

Run each step on `development`, then `staging`, then `production`. Never skip an environment.

1. Get the branch connection string (project Neon branches workflow: `neonctl connection-string <branch>`; branches `development`, `staging`, `production`). Never commit or paste it. Export it as `DATABASE_URL` in your shell only.
2. Audit: `psql "$DATABASE_URL" -f prisma/scripts/club-role-gm-audit.sql > audit-<env>.txt`
3. APPROVAL GATE: the product owner must review and approve the audit report for that environment (rule-3 list, rule-1 manual-review list). Do not continue without explicit approval. Decide which rule-3 rows (if any) get re-homed.
4. Backup/branch point: take a Neon branch/restore point before touching staging and production.
5. Cleanup: `psql "$DATABASE_URL" -v confirm=yes -f prisma/scripts/club-role-gm-cleanup.sql`
   - Without `-v confirm=yes` the script aborts before touching anything.
   - Optional re-home: add `-v rehome_ids='<assignment_id>,<assignment_id>'` (ids from the approved report). Default empty means no re-home. Re-home needs exactly one active GM section in the club and an active ecclesiastical year; otherwise the row is only ended.
   - Optional `-v snap=YYYYMMDD` to name the snapshot table (default `20261006`).
6. Re-run the audit: `RULE_3_GM_MEMBER_IN_AV_CQ` must be 0. Resolve rule-1 rows manually.
7. Move to the next environment.

## Rollback

`psql "$DATABASE_URL" -v confirm=yes [-v snap=YYYYMMDD] -f prisma/scripts/club-role-gm-restore.sql`

Restores the snapshotted rows and ends any re-homed rows (never deletes). Snapshot tables `club_role_assignments_gm_cleanup_snapshot_<snap>` and `..._rehome` are kept; drop them manually when no longer needed.

## Notes

- "Ended" follows `removeRoleAssignment()`: `active=false`, `status='ended'`, `end_date=today`. No hard deletes.
- Idempotent: re-running cleanup finds no violators and keeps the original snapshot.
- Do not run these scripts from CI or from an agent without the approval gate.
