import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(__dirname, '../..');
const read = (path: string) => readFileSync(resolve(ROOT, path), 'utf8');

const MIGRATION = read(
  'prisma/migrations/20261111130000_club_enrollments_validate_permission/migration.sql',
);
const SEED = read('prisma/seeds/role-permissions.seed.sql');
const PERMISSIONS_SEED = read('prisma/seeds/permissions.seed.sql');
const SCHEMA_MIGRATION = read(
  'prisma/migrations/20261111120000_club_enrollment_review/migration.sql',
);

const PERMISSION = 'club_enrollments:validate';
const VALIDATOR_ROLES = [
  'admin',
  'assistant-admin',
  'super-admin',
  'director-lf',
  'assistant-lf',
  'director-union',
  'assistant-union',
  'director-dia',
  'assistant-dia',
  'coordinator',
  'zone-coordinator',
  'general-coordinator',
  'pastor',
].sort();

/** Role names listed in the INSERT ... WHERE r.role_name IN (...) that grants `permission`. */
function grantedRoles(sql: string, permission: string): string[] {
  const inserts = sql
    .split(';')
    .filter(
      (statement) =>
        /INSERT INTO role_permissions/.test(statement) &&
        statement.includes(`p.permission_name = '${permission}'`),
    );
  expect(inserts).toHaveLength(1);
  const list = /r\.role_name IN \(([^)]*)\)/.exec(inserts[0]);
  return [...(list?.[1] ?? '').matchAll(/'([^']+)'/g)].map((m) => m[1]).sort();
}

describe('club_enrollments:validate permission', () => {
  it('is granted to the same roles by migration and seed', () => {
    expect(grantedRoles(MIGRATION, PERMISSION)).toEqual(VALIDATOR_ROLES);
    expect(grantedRoles(SEED, PERMISSION)).toEqual(VALIDATOR_ROLES);
  });

  it('never reaches club roles, members or plain users', () => {
    const roles = grantedRoles(MIGRATION, PERMISSION);
    for (const forbidden of [
      'director',
      'deputy-director',
      'secretary',
      'treasurer',
      'secretary-treasurer',
      'counselor',
      'instructor',
      'member',
      'user',
    ]) {
      expect(roles).not.toContain(forbidden);
    }
    // The seed wildcards may hand it to other roles; the cleanup takes it back.
    expect(SEED).toMatch(
      /p\.permission_name = 'club_enrollments:validate'\s+AND NOT \(/,
    );
  });

  it('inserts the permission row in the migration and the permissions seed', () => {
    expect(MIGRATION).toContain(`'${PERMISSION}'`);
    expect(PERMISSIONS_SEED).toContain(`'${PERMISSION}'`);
  });

  it('is idempotent: upserts the permission and the grants', () => {
    expect(MIGRATION).toContain('ON CONFLICT (permission_name) DO UPDATE');
    expect(MIGRATION).toContain(
      'ON CONFLICT (role_id, permission_id) DO UPDATE',
    );
    expect(MIGRATION).not.toMatch(/CONCURRENTLY/i);
  });
});

describe('club enrollment review migration', () => {
  it('adds the four nullable review columns and the reviewer foreign key', () => {
    for (const column of [
      '"reviewed_by_id" UUID',
      '"reviewer_role" VARCHAR(50)',
      '"reviewed_at" TIMESTAMPTZ(6)',
      '"decision_reason" TEXT',
    ]) {
      expect(SCHEMA_MIGRATION).toContain(column);
    }
    expect(SCHEMA_MIGRATION).not.toMatch(/NOT NULL/);
    expect(SCHEMA_MIGRATION).toMatch(
      /FOREIGN KEY \("reviewed_by_id"\) REFERENCES "users"\("user_id"\) ON DELETE NO ACTION/,
    );
  });
});
