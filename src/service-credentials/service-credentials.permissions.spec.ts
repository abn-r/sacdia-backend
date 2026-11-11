import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(__dirname, '../..');
const MIGRATION = readFileSync(
  resolve(
    ROOT,
    'prisma/migrations/20261110130000_service_credentials_permissions/migration.sql',
  ),
  'utf8',
);
const SEED = readFileSync(
  resolve(ROOT, 'prisma/seeds/role-permissions.seed.sql'),
  'utf8',
);
const PERMISSIONS_SEED = readFileSync(
  resolve(ROOT, 'prisma/seeds/permissions.seed.sql'),
  'utf8',
);

const REVIEW_ROLES = [
  'admin',
  'coordinator',
  'director-lf',
  'assistant-lf',
  'general-coordinator',
  'pastor',
  'super-admin',
  'zone-coordinator',
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

describe('service credential permissions', () => {
  it.each([
    ['service_credentials:review', REVIEW_ROLES],
    ['role_requirements:manage', ['admin', 'super-admin']],
  ])(
    '%s is granted to the same roles by migration and seed',
    (permission, roles) => {
      expect(grantedRoles(MIGRATION, permission)).toEqual(roles);
      expect(grantedRoles(SEED, permission)).toEqual(roles);
    },
  );

  it('never reaches assistant-admin, union, division or club roles', () => {
    for (const permission of [
      'service_credentials:review',
      'role_requirements:manage',
    ]) {
      const roles = grantedRoles(MIGRATION, permission);
      for (const forbidden of [
        'assistant-admin',
        'director-union',
        'assistant-union',
        'director-dia',
        'assistant-dia',
        'director',
        'counselor',
        'user',
      ]) {
        expect(roles).not.toContain(forbidden);
      }
    }
    // The seed wildcards hand assistant-admin everything; the cleanup takes it back.
    expect(SEED).toMatch(
      /p\.permission_name = 'service_credentials:review'\s+AND NOT \(/,
    );
  });

  it('inserts both permission rows in the migration and the permissions seed', () => {
    for (const sql of [MIGRATION, PERMISSIONS_SEED]) {
      expect(sql).toContain("'service_credentials:review'");
      expect(sql).toContain("'role_requirements:manage'");
    }
  });
});
