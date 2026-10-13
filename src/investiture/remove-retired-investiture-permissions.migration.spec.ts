import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const PRISMA_DIR = join(__dirname, '../../prisma');
const MIGRATION_NAME = '20261013110000_remove_retired_investiture_permissions';

const RETIRED_PERMISSIONS = [
  'investiture:submit',
  'investiture:validate',
  'investiture:mark_invested',
  'investiture_config:read',
  'investiture_config:create',
  'investiture_config:update',
  'investiture_config:delete',
] as const;

const migration = readFileSync(
  join(PRISMA_DIR, 'migrations', MIGRATION_NAME, 'migration.sql'),
  'utf8',
);
/** El SQL sin comentarios: así los avisos del encabezado no cuentan como DDL. */
const ddl = migration
  .split('\n')
  .filter((line) => !line.trim().startsWith('--'))
  .join('\n');

describe('remove retired investiture permissions migration (20261013110000)', () => {
  it('deletes grants before the permission rows (users_permissions, role_permissions, permissions)', () => {
    const userGrants = ddl.indexOf('DELETE FROM users_permissions');
    const roleGrants = ddl.indexOf('DELETE FROM role_permissions');
    const catalog = ddl.indexOf('DELETE FROM permissions');
    expect(userGrants).toBeGreaterThanOrEqual(0);
    expect(roleGrants).toBeGreaterThan(userGrants);
    expect(catalog).toBeGreaterThan(roleGrants);
  });

  it('targets exactly the seven retired permission codes and never investiture:read', () => {
    const literals = [...ddl.matchAll(/'([a-z_]+:[a-z_]+)'/g)].map((m) => m[1]);
    expect(new Set(literals)).toEqual(new Set(RETIRED_PERMISSIONS));
    expect(ddl).not.toContain('investiture:read');
    expect(ddl).not.toMatch(/LIKE|ILIKE|~/);
  });

  it('is a plain idempotent script: no transaction control, CONCURRENTLY, TRUNCATE or DDL', () => {
    expect(ddl).not.toMatch(/\bBEGIN\b|\bCOMMIT\b|\bROLLBACK\b/i);
    expect(ddl).not.toMatch(/CONCURRENTLY/i);
    expect(ddl).not.toMatch(/TRUNCATE|DROP |ALTER |CREATE |INSERT /i);
    expect(ddl).not.toMatch(/FROM audit|FROM .*_history|FROM .*_logs/i);
  });
});

describe('seeds no longer recreate the retired investiture permissions', () => {
  const seeds = ['permissions.seed.sql', 'role-permissions.seed.sql'].map(
    (file) => ({
      file,
      sql: readFileSync(join(PRISMA_DIR, 'seeds', file), 'utf8'),
    }),
  );

  it.each(RETIRED_PERMISSIONS)('%s is absent from every seed', (code) => {
    for (const { file, sql } of seeds) {
      expect({ file, present: sql.includes(`'${code}'`) }).toEqual({
        file,
        present: false,
      });
    }
  });

  it('keeps investiture:read in the permission catalog and role grants', () => {
    expect(seeds[0].sql).toContain("'investiture:read'");
    expect(seeds[1].sql).toContain("'investiture:read'");
  });
});
