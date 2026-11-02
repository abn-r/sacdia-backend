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

describe('union and division ranking reads survive the seed', () => {
  it.each([
    ['director-union', 'member_rankings:read_union'],
    ['director-union', 'section_rankings:read_union'],
    ['assistant-union', 'member_rankings:read_union'],
    ['assistant-union', 'section_rankings:read_union'],
    ['director-dia', 'member_rankings:read_division'],
    ['director-dia', 'section_rankings:read_division'],
    ['assistant-dia', 'member_rankings:read_division'],
    ['assistant-dia', 'section_rankings:read_division'],
  ])('%s keeps %s after its last wipe', (role, permission) => {
    const wipe = lastRoleWipe(role);
    expect(wipe).toBeGreaterThan(-1);
    expect(grantedAfter(role, permission, wipe)).toBe(true);
  });

  it('the seed declares the four permissions', () => {
    const permissions = read('seeds/permissions.seed.sql');
    for (const name of [
      'member_rankings:read_union',
      'member_rankings:read_division',
      'section_rankings:read_union',
      'section_rankings:read_division',
    ]) {
      expect(permissions).toContain(`'${name}'`);
    }
  });

  it('the migration grants the same rows', () => {
    const migration = collapse(
      read(
        'migrations/20261030120000_union_division_ranking_reads/migration.sql',
      ),
    );
    expect(migration).toContain(
      "r.role_name IN ('director-union', 'assistant-union')",
    );
    expect(migration).toContain(
      "p.permission_name IN ('member_rankings:read_union', 'section_rankings:read_union')",
    );
    expect(migration).toContain(
      "r.role_name IN ('director-dia', 'assistant-dia')",
    );
    expect(migration).toContain(
      "p.permission_name IN ('member_rankings:read_division', 'section_rankings:read_division')",
    );
  });
});

describe('admin and union grants of 2026-10-30', () => {
  const migration = collapse(
    read(
      'migrations/20261030140000_admin_and_union_permission_grants/migration.sql',
    ),
  );
  const seed = collapse(read('seeds/role-permissions.seed.sql'));

  it('re-applies the super-admin, admin and assistant-admin seed rules', () => {
    expect(migration).toContain("WHERE r.role_name = 'super-admin'");
    expect(migration).toMatch(
      /WHERE r\.role_name = 'admin' .* AND p\.permission_name NOT LIKE '%:delete' AND p\.permission_name <> 'audit:read'/,
    );
    expect(migration).toContain(
      "AND p.permission_name <> 'permissions:assign'",
    );
  });

  it('gives admin the deletes a territorial role holds, in seed and migration', () => {
    for (const sql of [migration, seed]) {
      expect(sql).toContain("WHERE admin.role_name = 'admin'");
      expect(sql).toContain("AND p.permission_name LIKE '%:delete' AND EXISTS");
    }
  });

  it.each(['director-union', 'assistant-union'])(
    '%s keeps the camporee_events grants after its last wipe',
    (role) => {
      const wipe = lastRoleWipe(role);
      for (const permission of [
        'camporee_events:create',
        'camporee_events:read',
        'camporee_events:update',
        'camporee_events:delete',
        'camporee_event_types:read',
      ]) {
        expect(grantedAfter(role, permission, wipe)).toBe(true);
        expect(migration).toContain(`'${permission}'`);
      }
    },
  );
});

describe('platform admin seed cleanups after the 2026-10-30 grants', () => {
  const cleanup = collapse(
    read(
      'migrations/20261030150000_platform_admin_seed_cleanups/migration.sql',
    ),
  );
  const seed = collapse(read('seeds/role-permissions.seed.sql'));

  it.each([
    'camporees:register',
    'camporees:register_active_section',
    'camporee-orders:create',
    'camporee-orders:upload-proof',
    'camporee-orders:distribute',
    'camporee-supplies:plan',
  ])('removes %s from the platform admin roles', (permission) => {
    expect(cleanup).toContain(
      "r.role_name IN ('super-admin', 'admin', 'assistant-admin')",
    );
    expect(cleanup).toContain(`'${permission}'`);
  });

  it('keeps insurance:configure for admin and super-admin in seed and migration', () => {
    expect(seed).toContain(
      "AND p.permission_name = 'insurance:configure' AND NOT ( r.role_name IN ('assistant-lf', 'director-lf', 'admin', 'super-admin')",
    );
    expect(cleanup).toMatch(
      /r\.role_name = 'assistant-admin' .* p\.permission_name = 'insurance:configure'/,
    );
  });
});

describe('seed-only permissions and seed cleanups (2026-11-02)', () => {
  const migration = read(
    'migrations/20261102120000_seed_only_permissions_and_cleanups/migration.sql',
  );
  const collapsedMigration = collapse(migration);
  const permissionsSeed = stripComments(read('seeds/permissions.seed.sql'));
  const seedRow = (name: string) =>
    new RegExp(`\\('${name}',\\s*'([^']*)',\\s*(true|false)\\)`).exec(
      permissionsSeed,
    );

  it.each([
    'users:create',
    'users:bulk_create',
    'insurance:review',
    'insurance:configure',
    'certifications:configure',
    'certifications:publish',
    'certifications:review',
    'certifications:certify',
    'camporee-supplies:read',
    'camporee-supplies:plan',
    'camporee-supplies:configure',
    'camporee-supplies:review-pay',
    'camporee-supplies:deliver',
  ])('inserts %s with its seed row', (name) => {
    const row = seedRow(name);
    expect(row?.[2]).toBe('true');
    expect(migration).toContain(`('${name}', '${row?.[1]}', true)`);
  });

  it('re-runs every per-permission cleanup of the seed', () => {
    const cleanups = collapse(SEED)
      .split(';')
      .map((statement) => statement.trim())
      .filter(
        (statement) =>
          statement.startsWith('DELETE FROM role_permissions rp') &&
          statement.includes('AND NOT ('),
      );
    expect(cleanups.length).toBeGreaterThanOrEqual(16);
    for (const cleanup of cleanups) {
      expect(collapsedMigration).toContain(cleanup);
    }
  });

  it('retires every permission the seed marks inactive', () => {
    const inactive = [
      ...permissionsSeed.matchAll(
        /\('([a-z_-]+:[a-z_-]+)',\s*'[^']*',\s*false\)/g,
      ),
    ].map((match) => match[1]);
    expect(inactive.length).toBeGreaterThan(0);
    for (const name of inactive) {
      expect(migration).toContain(`'${name}'`);
    }
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

describe('role permissions aligned with the seeds (2026-11-02)', () => {
  const migration = read(
    'migrations/20261102130000_align_role_permissions_with_seed/migration.sql',
  );
  const statements = collapse(migration)
    .split(';')
    .map((statement) => statement.trim())
    .filter(Boolean);

  it('runs as one transaction', () => {
    expect(statements[0]).toBe('BEGIN');
    expect(statements[statements.length - 1]).toBe('COMMIT');
    expect(
      statements.filter((s) => s === 'BEGIN' || s === 'COMMIT'),
    ).toHaveLength(2);
  });

  it('wipes and re-seeds every role the seed wipes', () => {
    const roles = [
      ...SEED.matchAll(
        /DELETE FROM role_permissions\s+WHERE role_id = \(\s*SELECT role_id FROM roles\s+WHERE role_name = '([a-z-]+)'/g,
      ),
    ].map((match) => match[1]);
    expect(roles.length).toBeGreaterThan(15);
    for (const role of roles) {
      expect(migration).toMatch(
        new RegExp(
          `DELETE FROM role_permissions\\s+WHERE role_id = \\(\\s*SELECT role_id FROM roles\\s+WHERE role_name = '${role}'`,
        ),
      );
    }
  });

  it('creates every permission of permissions.seed.sql', () => {
    const permissionsSeed = stripComments(read('seeds/permissions.seed.sql'));
    const names = [
      ...permissionsSeed.matchAll(/\('([a-z_-]+:[a-z_-]+)',\s*'/g),
    ].map((match) => match[1]);
    expect(names.length).toBeGreaterThan(200);
    for (const name of names) {
      expect(migration).toContain(`('${name}',`);
    }
  });

  it('never grants camporee event writes to club roles', () => {
    const clubWrites = statements.filter(
      (statement) =>
        statement.includes('INSERT INTO role_permissions') &&
        statement.includes("r.role_category = 'CLUB'") &&
        /'camporee_events:(create|update|delete)'/.test(statement),
    );
    expect(clubWrites).toEqual([]);
  });
});

describe('treasurer monthly reports are read-only (2026-11-02)', () => {
  const migration = collapse(
    read(
      'migrations/20261102140000_treasurer_monthly_report_read_only/migration.sql',
    ),
  );

  it('the seed treasurer block keeps read and download only', () => {
    const start = lastRoleWipe('treasurer');
    const block = SEED.slice(start).split(';')[1];
    expect(block).toContain("'reports:read'");
    expect(block).toContain("'reports:download'");
    expect(block).not.toContain("'reports:submit'");
    expect(block).not.toContain("'reports:write'");
    expect(grantedAfter('treasurer', 'reports:submit', start)).toBe(false);
    expect(grantedAfter('treasurer', 'reports:write', start)).toBe(false);
  });

  it('the migration removes submit and write from the club treasurer', () => {
    expect(migration).toContain("r.role_name = 'treasurer'");
    expect(migration).toContain("r.role_category = 'CLUB'");
    expect(migration).toContain(
      "p.permission_name IN ('reports:submit', 'reports:write')",
    );
  });
});
