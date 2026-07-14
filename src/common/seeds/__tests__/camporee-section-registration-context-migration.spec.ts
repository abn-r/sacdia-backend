import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  findSqlStatementPositions,
  normalizeSql,
  stripSqlComments,
} from './sql-contract-test-utils';

const PRISMA_DIR = join(__dirname, '..', '..', '..', '..', 'prisma');
const MIGRATION_PATH = join(
  PRISMA_DIR,
  'migrations',
  '20260713220000_camporee_section_registration_context',
  'migration.sql',
);
const SCHEMA_PATH = join(PRISMA_DIR, 'schema.prisma');

const LOCAL_DUPLICATE_GUARD = `IF EXISTS ( SELECT 1 FROM "camporee_clubs" WHERE "active" = TRUE AND "camporee_id" IS NOT NULL AND "club_section_id" IS NOT NULL GROUP BY "camporee_id", "club_section_id" HAVING COUNT(*) > 1 ) THEN RAISE EXCEPTION USING ERRCODE = '23505', MESSAGE = 'Cannot enforce active local camporee section uniqueness: duplicate active camporee_clubs rows exist for (camporee_id, club_section_id).', HINT = 'Remediation: review the duplicates and explicitly deactivate or correct the invalid registrations, then retry this migration. No rows were deleted or merged.'; END IF;`;
const UNION_DUPLICATE_GUARD = `IF EXISTS ( SELECT 1 FROM "camporee_clubs" WHERE "active" = TRUE AND "union_camporee_id" IS NOT NULL AND "club_section_id" IS NOT NULL GROUP BY "union_camporee_id", "club_section_id" HAVING COUNT(*) > 1 ) THEN RAISE EXCEPTION USING ERRCODE = '23505', MESSAGE = 'Cannot enforce active union camporee section uniqueness: duplicate active camporee_clubs rows exist for (union_camporee_id, club_section_id).', HINT = 'Remediation: review the duplicates and explicitly deactivate or correct the invalid registrations, then retry this migration. No rows were deleted or merged.'; END IF;`;
const LOCAL_UNIQUE_INDEX = `CREATE UNIQUE INDEX "uq_camporee_clubs_active_local_section" ON "camporee_clubs"("camporee_id", "club_section_id") WHERE "active" = TRUE AND "camporee_id" IS NOT NULL;`;
const UNION_UNIQUE_INDEX = `CREATE UNIQUE INDEX "uq_camporee_clubs_active_union_section" ON "camporee_clubs"("union_camporee_id", "club_section_id") WHERE "active" = TRUE AND "union_camporee_id" IS NOT NULL;`;
const LEGACY_REGISTRATION_PERMISSION = 'camporees:register';
const TERRITORIAL_ORGANIZER_ROLES = [
  'assistant-lf',
  'director-lf',
  'assistant-union',
  'director-union',
] as const;

describe('Camporee section registration context migration contract', () => {
  const migration = normalizeSql(
    stripSqlComments(readFileSync(MIGRATION_PATH, 'utf8')),
  );
  const schema = readFileSync(SCHEMA_PATH, 'utf8');

  it('fails on both local and union duplicate active section registrations', () => {
    expect(migration).toContain(LOCAL_DUPLICATE_GUARD);
    expect(migration).toContain(UNION_DUPLICATE_GUARD);
  });

  it('creates both partial unique indexes with their exact keys and predicates', () => {
    expect(migration).toContain(LOCAL_UNIQUE_INDEX);
    expect(migration).toContain(UNION_UNIQUE_INDEX);
  });

  it('runs duplicate guards before indexes inside one rollback-safe transaction', () => {
    const localGuardIndex = migration.indexOf(LOCAL_DUPLICATE_GUARD);
    const unionGuardIndex = migration.indexOf(UNION_DUPLICATE_GUARD);
    const localUniqueIndex = migration.indexOf(LOCAL_UNIQUE_INDEX);
    const unionUniqueIndex = migration.indexOf(UNION_UNIQUE_INDEX);
    const beginPositions = findSqlStatementPositions(migration, 'BEGIN');
    const commitPositions = findSqlStatementPositions(migration, 'COMMIT');
    const commitIndex = commitPositions[0] ?? -1;

    expect(beginPositions).toEqual([0]);
    expect(commitPositions).toHaveLength(1);
    expect(migration.endsWith('COMMIT;')).toBe(true);
    expect(localGuardIndex).toBeGreaterThan(-1);
    expect(unionGuardIndex).toBeGreaterThan(localGuardIndex);
    expect(localUniqueIndex).toBeGreaterThan(unionGuardIndex);
    expect(unionUniqueIndex).toBeGreaterThan(localUniqueIndex);
    expect(commitIndex).toBeGreaterThan(unionUniqueIndex);
    expect(hasRollbackSafeProtectedOrder(migration)).toBe(true);
  });

  it('rejects an intermediate COMMIT before the protected unique indexes', () => {
    const withIntermediateCommit = migration.replace(
      LOCAL_UNIQUE_INDEX,
      `COMMIT; ${LOCAL_UNIQUE_INDEX}`,
    );

    expect(hasRollbackSafeProtectedOrder(withIntermediateCommit)).toBe(false);
  });

  it('documents both database-managed partial unique indexes beside camporee_clubs', () => {
    const camporeeClubsModel = extractPrismaModel(schema, 'camporee_clubs');

    expect(camporeeClubsModel).toContain(
      'uq_camporee_clubs_active_local_section',
    );
    expect(camporeeClubsModel).toContain(
      'uq_camporee_clubs_active_union_section',
    );
    expect(camporeeClubsModel).toContain(
      'Prisma cannot model partial unique indexes',
    );
  });

  it('upserts legacy registration and finishes with exactly four territorial role grants', () => {
    const permissionUpsert = migration.indexOf(
      `INSERT INTO "permissions" ("permission_name", "description", "active") VALUES ( '${LEGACY_REGISTRATION_PERMISSION}',`,
    );
    const cleanup = extractLegacyPermissionCleanup(migration);
    const cleanupIndex = migration.indexOf(cleanup);
    const grant = extractLegacyPermissionGrant(migration);
    const grantIndex = migration.indexOf(grant.statement);
    const commitIndex = findSqlStatementPositions(migration, 'COMMIT')[0] ?? -1;

    expect(permissionUpsert).toBeGreaterThan(-1);
    expect(cleanupIndex).toBeGreaterThan(permissionUpsert);
    expect(grantIndex).toBeGreaterThan(cleanupIndex);
    expect(commitIndex).toBeGreaterThan(grantIndex);
    expect(grant.roles).toEqual([...TERRITORIAL_ORGANIZER_ROLES].sort());
    expect(grant.statement).toContain(
      'ON CONFLICT ("role_id", "permission_id") DO UPDATE SET "active" = TRUE, "modified_at" = NOW();',
    );
  });
});

function extractPrismaModel(schema: string, modelName: string): string {
  const startMarker = `model ${modelName} {`;
  const startIndex = schema.indexOf(startMarker);
  if (startIndex < 0) {
    throw new Error(`Could not locate Prisma model '${modelName}'`);
  }

  const endIndex = schema.indexOf('\nmodel ', startIndex + startMarker.length);
  if (endIndex < 0) {
    throw new Error(`Could not locate end of Prisma model '${modelName}'`);
  }

  return schema.slice(startIndex, endIndex);
}

function hasRollbackSafeProtectedOrder(sql: string): boolean {
  const localGuardIndex = sql.indexOf(LOCAL_DUPLICATE_GUARD);
  const unionGuardIndex = sql.indexOf(UNION_DUPLICATE_GUARD);
  const localUniqueIndex = sql.indexOf(LOCAL_UNIQUE_INDEX);
  const unionUniqueIndex = sql.indexOf(UNION_UNIQUE_INDEX);
  const beginPositions = findSqlStatementPositions(sql, 'BEGIN');
  const commitPositions = findSqlStatementPositions(sql, 'COMMIT');
  const beginIndex = beginPositions[0] ?? -1;
  const commitIndex = commitPositions[0] ?? -1;

  return (
    beginPositions.length === 1 &&
    commitPositions.length === 1 &&
    beginIndex === 0 &&
    sql.endsWith('COMMIT;') &&
    localGuardIndex > beginIndex &&
    unionGuardIndex > localGuardIndex &&
    localUniqueIndex > unionGuardIndex &&
    unionUniqueIndex > localUniqueIndex &&
    commitIndex > unionUniqueIndex
  );
}

function extractLegacyPermissionCleanup(sql: string): string {
  const cleanup = sql.match(
    /DELETE FROM "role_permissions" rp USING "permissions" p, "roles" r WHERE rp\."permission_id" = p\."permission_id" AND rp\."role_id" = r\."role_id" AND p\."permission_name" = 'camporees:register' AND NOT \( r\."role_name" IN \([^)]+\) AND r\."role_category" = 'GLOBAL' \);/,
  )?.[0];
  if (!cleanup) throw new Error('Could not locate legacy permission cleanup');
  return cleanup;
}

function extractLegacyPermissionGrant(sql: string): {
  statement: string;
  roles: string[];
} {
  const match = sql.match(
    /INSERT INTO "role_permissions" \([^)]+\) SELECT [^;]+?WHERE r\."role_name" IN \(([^)]+)\) AND r\."role_category" = 'GLOBAL'[^;]+?AND p\."permission_name" = 'camporees:register'[^;]+?ON CONFLICT \("role_id", "permission_id"\) DO UPDATE SET "active" = TRUE, "modified_at" = NOW\(\);/,
  );
  if (!match) throw new Error('Could not locate legacy permission grant');

  return {
    statement: match[0],
    roles: [...match[1].matchAll(/'([^']+)'/g)].map((role) => role[1]).sort(),
  };
}
