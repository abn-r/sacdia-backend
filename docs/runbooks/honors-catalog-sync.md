# Runbook: Honors Catalog Sync (staging and production)

**Change**: `fix_legacy_honors_club_type` + Adventurer specialties import
**Why**: development already has the corrected legacy catalog and the 175 Adventurer honors; staging and production still have the seed's wrong club types and no Adventurer honors.

Order matters: run the migration (step 1) BEFORE the importer (step 2), and finish with the verification queries (step 3). Do staging first, then production.

Rules for every step:
- Never print or paste a connection string. Keep it in a shell variable and pass it through the environment.
- Shadow DB is broken: never use `prisma migrate dev`.
- Neon project: `wispy-hall-32797215`. Branches: `staging`, `production`.

```bash
# Replace <branch> with staging or production. Do not echo the variable.
export DATABASE_URL="$(neonctl connection-string <branch> --project-id wispy-hall-32797215)"
```

## 1. Apply the migration `20261014100000_fix_legacy_honors_club_type`

What it does: for every honor with `code LIKE 'LEGACY-%'` sets `honors.club_type_id = 2` (Conquistadores) and leaves exactly one active `honor_club_types` row with `club_type_id = 2`. `LEGACY-649` "Bioseguridad" stays Guias Mayores (3); it is guarded by code AND name. Non-legacy honors (`ADV-*`) are never touched. It is idempotent and ends with a sanity check that raises if anything is inconsistent.

If the Render deploy of this branch already ran `prisma migrate deploy` on the target database, the migration is already applied and registered: skip to step 3 and just verify. Otherwise apply it manually (from `sacdia-backend/`):

```bash
M=20261014100000_fix_legacy_honors_club_type
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f prisma/migrations/$M/migration.sql

# sha256 of the exact file that Prisma will compare against
CHECKSUM="$(shasum -a 256 prisma/migrations/$M/migration.sql | cut -d' ' -f1)"

psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -v checksum="$CHECKSUM" -v name="$M" <<'SQL'
INSERT INTO "_prisma_migrations"
  (id, checksum, finished_at, migration_name, logs, rolled_back_at, started_at, applied_steps_count)
SELECT gen_random_uuid()::text, :'checksum', now(), :'name', NULL, NULL, now(), 1
WHERE NOT EXISTS (
  SELECT 1 FROM "_prisma_migrations" WHERE migration_name = :'name'
);
SQL
```

Notes:
- `psql -f` runs each statement in its own implicit transaction. A failure in the final sanity block raises an exception and `ON_ERROR_STOP=1` aborts. The earlier statements are already committed, but they are idempotent: fix the cause and re-run the same file.
- The checksum must be the sha256 of the file as committed. If the file changes afterwards, update the checksum in `_prisma_migrations` or `migrate deploy` will report drift.

## 2. Run the Adventurer specialties importer

Script: `scripts/import-adventurer-specialties.ts`. Run from `sacdia-backend/`. Dataset defaults to `../docs/working/aventureros-especialidades/index.csv`.

Env:
- `ADVENTURER_SPECIALTIES_IMPORT_DATABASE_URL` (optional override) or `DATABASE_URL`. Use the target branch URL, never a local one.
- `--apply` additionally requires `R2_PUBLIC_URL_HONORS_IMAGES` and `R2_PUBLIC_URL_HONORS_PDF` (same values as the target environment); the manifest URLs are validated against them.

```bash
# 2a. Dry run (default). Reads the DB, writes nothing. Must finish with zero errors.
pnpm exec tsx scripts/import-adventurer-specialties.ts --dry-run

# 2b. Apply. Idempotent upserts keyed by code (ADV-*).
pnpm exec tsx scripts/import-adventurer-specialties.ts --apply \
  --manifest ../docs/working/aventureros-especialidades/r2-manifest.json
```

Expected apply result on a branch that has never been imported: 175 honors created, 175 honor club types upserted. Re-running reports updates instead of creations.

## 3. Verification (read-only)

```sql
-- 3a. Counts by club type in honors vs honor_club_types (active rows only).
SELECT 'honors' AS source, club_type_id, count(*)
FROM honors GROUP BY club_type_id
UNION ALL
SELECT 'honor_club_types', club_type_id, count(*)
FROM honor_club_types WHERE active = true GROUP BY club_type_id
ORDER BY 1, 2;
-- After migration + import: legacy honors under club_type 2 (except 649 under 3),
-- 175 Adventurer honors under club_type 1 in BOTH tables.

-- 3b. Conflicts: honors whose club_type_id has no matching active honor_club_types row. Must be 0.
SELECT count(*) AS conflicts
FROM honors h
WHERE NOT EXISTS (
  SELECT 1 FROM honor_club_types hct
  WHERE hct.honor_id = h.honor_id
    AND hct.club_type_id = h.club_type_id
    AND hct.active = true
);

-- 3c. Legacy honors that are not Conquistadores (only LEGACY-649 may appear, with 3).
SELECT h.honor_id, h.code, h.name, h.club_type_id
FROM honors h
WHERE h.code LIKE 'LEGACY-%' AND h.club_type_id <> 2;

-- 3d. Legacy honors with more than one honor_club_types row. Must return no rows.
SELECT honor_id, count(*)
FROM honor_club_types
WHERE honor_id IN (SELECT honor_id FROM honors WHERE code LIKE 'LEGACY-%')
GROUP BY honor_id HAVING count(*) <> 1;

-- 3e. Adventurer honors present (code prefix ADV-).
SELECT count(*) AS adventurer_honors FROM honors WHERE code LIKE 'ADV-%';
```

Smoke check after both steps: a Pathfinders club section lists the standard honors, and an Adventurers section lists only the `ADV-*` ones.
