import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Seed and migration parity fixes from admin QA (block E). The SQL and seed
 * scripts are not executed here; the spec pins the statements that matter.
 */

const PRISMA_DIR = join(__dirname, '../../prisma');
const read = (path: string) => readFileSync(join(PRISMA_DIR, path), 'utf8');
const stripComments = (sql: string) => sql.replace(/--[^\n]*/g, '');
const collapse = (sql: string) => stripComments(sql).replace(/\s+/g, ' ');

const SEED = stripComments(read('seeds/role-permissions.seed.sql'));

/**
 * Offset where the seed last wipes every row of a role. Grants written
 * before it are lost on each seed run.
 */
function lastRoleWipe(role: string): number {
  const wipe = new RegExp(
    `DELETE FROM role_permissions\\s+WHERE role_id = \\(\\s*SELECT role_id FROM roles\\s+WHERE role_name = '${role}'`,
    'g',
  );
  let last = -1;
  for (const match of SEED.matchAll(wipe)) last = match.index ?? last;
  return last;
}

/** INSERT statements after `from` that name both the role and the permission. */
function grantedAfter(role: string, permission: string, from: number) {
  return SEED.slice(from)
    .split(';')
    .some(
      (statement) =>
        statement.includes('INSERT INTO role_permissions') &&
        statement.includes(`'${role}'`) &&
        statement.includes(`'${permission}'`),
    );
}

describe('local field ranking reads survive the seed', () => {
  it.each([
    ['director-lf', 'member_rankings:read_lf'],
    ['director-lf', 'section_rankings:read_lf'],
    ['director-lf', 'member_ranking_weights:read'],
    ['assistant-lf', 'member_rankings:read_lf'],
    ['assistant-lf', 'section_rankings:read_lf'],
  ])('%s keeps %s after its last wipe', (role, permission) => {
    const wipe = lastRoleWipe(role);
    expect(wipe).toBeGreaterThan(-1);
    expect(grantedAfter(role, permission, wipe)).toBe(true);
  });

  it('the restore migration grants the same rows', () => {
    const migration = collapse(
      read('migrations/20261028130100_restore_lf_ranking_reads/migration.sql'),
    );
    expect(migration).toContain(
      "r.role_name IN ('director-lf', 'assistant-lf')",
    );
    expect(migration).toContain(
      "p.permission_name IN ('member_rankings:read_lf', 'section_rankings:read_lf')",
    );
    expect(migration).toContain(
      "p.permission_name = 'member_ranking_weights:read'",
    );
    expect(migration).toContain(
      'ON CONFLICT (role_id, permission_id) DO NOTHING',
    );
  });
});

describe('assistant-admin role migration', () => {
  const migration = collapse(
    read('migrations/20261028130000_ensure_assistant_admin_role/migration.sql'),
  );

  it('creates the role only when it is missing', () => {
    expect(migration).toMatch(
      /INSERT INTO roles \(role_name, role_category, description, active\) VALUES \( 'assistant-admin', 'GLOBAL',/,
    );
    expect(migration).toContain('ON CONFLICT (role_name) DO NOTHING');
  });

  it('grants the same permission filter as the seed block', () => {
    const filter = [
      "p.permission_name NOT LIKE '%:delete'",
      "p.permission_name <> 'audit:read'",
      "p.permission_name <> 'permissions:assign'",
    ];
    const seedBlock = collapse(SEED).split(
      "WHERE r.role_name = 'assistant-admin'",
    )[1];
    for (const clause of filter) {
      expect(seedBlock).toContain(clause);
      expect(migration).toContain(clause);
    }
  });

  it('skips every capability the seed cleanups take away from assistant-admin', () => {
    // Seed cleanups: `DELETE ... permission_name IN (...) AND NOT (role_name
    // IN (<allowed roles>))`, run after the role blocks.
    const reservedBySeed = new Set<string>();
    for (const statement of SEED.split(';')) {
      if (!statement.includes('DELETE FROM role_permissions rp')) continue;
      const [target, allowed] = statement.split('AND NOT');
      if (allowed === undefined || allowed.includes("'assistant-admin'")) {
        continue;
      }
      for (const match of target.matchAll(/'([a-z_-]+:[a-z_-]+)'/g)) {
        reservedBySeed.add(match[1]);
      }
    }

    const excluded = migration.match(/p\.permission_name NOT IN \(([^)]*)\)/);
    expect(excluded).not.toBeNull();
    const excludedByMigration = [
      ...(excluded?.[1] ?? '').matchAll(/'([a-z_-]+:[a-z_-]+)'/g),
    ].map((m) => m[1]);

    expect(reservedBySeed.size).toBeGreaterThan(0);
    expect(excludedByMigration.sort()).toEqual([...reservedBySeed].sort());
  });
});

describe('test users seed', () => {
  const seed = read('seeds/test-users.seed.ts');

  it('creates every test account with an adult birthday', () => {
    expect(seed).toMatch(
      /const TEST_USER_BIRTHDAY = new Date\('1990-05-10T00:00:00\.000Z'\)/,
    );
    expect(seed).toMatch(/create: \{[^}]*birthday: TEST_USER_BIRTHDAY,/);
  });

  it('fills a missing birthday on existing accounts without overwriting one', () => {
    expect(seed).toMatch(
      /updateMany\(\{\s*where: \{ user_id: user\.user_id, birthday: null \},\s*data: \{ birthday: TEST_USER_BIRTHDAY \},/,
    );
  });
});

describe('union leadership has no unscoped ranking reads', () => {
  const GLOBAL_READS = [
    'member_rankings:read_global',
    'section_rankings:read_global',
  ];

  it('the seed never grants read_global to union roles', () => {
    for (const role of ['director-union', 'assistant-union']) {
      for (const permission of GLOBAL_READS) {
        expect(grantedAfter(role, permission, 0)).toBe(false);
      }
    }
  });

  it('a migration revokes the rows granted by 20260429000002', () => {
    const migration = collapse(
      read(
        'migrations/20261028130200_revoke_union_global_ranking_reads/migration.sql',
      ),
    );
    expect(migration).toContain('DELETE FROM role_permissions rp');
    expect(migration).toContain(
      "r.role_name IN ('director-union', 'assistant-union')",
    );
    expect(migration).toContain(
      "p.permission_name IN ('member_rankings:read_global', 'section_rankings:read_global')",
    );
    expect(migration).not.toContain('member_ranking_weights');
  });
});
