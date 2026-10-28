import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * The GLOBAL coordinator roles form a ladder: zone-coordinator oversees
 * coordinators, general-coordinator oversees both. The seed must keep each
 * rung a superset of the one below, or a higher coordinator loses a screen the
 * lower one has (resources:read was missing on zone/general until migration
 * 20261028120000_coordinator_roles_resources_read).
 */

const PRISMA_DIR = join(__dirname, '../../prisma');
const LADDER = ['coordinator', 'zone-coordinator', 'general-coordinator'] as const;
type CoordinatorRole = (typeof LADDER)[number];

function stripComments(sql: string): string {
  return sql.replace(/--[^\n]*/g, '');
}

/**
 * Permissions each coordinator role gets from `INSERT INTO role_permissions`
 * statements. A statement counts for every coordinator role it names and every
 * permission literal it lists.
 */
function grantsBySeedRole(sql: string): Record<CoordinatorRole, Set<string>> {
  const grants = Object.fromEntries(
    LADDER.map((role) => [role, new Set<string>()]),
  ) as Record<CoordinatorRole, Set<string>>;

  for (const statement of stripComments(sql).split(';')) {
    if (!statement.includes('INSERT INTO role_permissions')) continue;
    const roles = new Set(
      [...statement.matchAll(/'((?:zone-|general-)?coordinator)'/g)].map(
        (m) => m[1] as CoordinatorRole,
      ),
    );
    const permissions = [...statement.matchAll(/'([a-z_-]+:[a-z_-]+)'/g)].map(
      (m) => m[1],
    );
    for (const role of roles) {
      for (const permission of permissions) grants[role].add(permission);
    }
  }
  return grants;
}

describe('coordinator role permissions (seed)', () => {
  const seed = readFileSync(
    join(PRISMA_DIR, 'seeds/role-permissions.seed.sql'),
    'utf8',
  );
  const grants = grantsBySeedRole(seed);

  it.each([
    ['coordinator', 'zone-coordinator'],
    ['zone-coordinator', 'general-coordinator'],
  ] as const)('%s permissions are a subset of %s', (lower, higher) => {
    const missing = [...grants[lower]].filter((p) => !grants[higher].has(p));
    expect(missing).toEqual([]);
  });

  it.each(LADDER)('%s reads the resource library', (role) => {
    expect(grants[role].has('resources:read')).toBe(true);
    expect(grants[role].has('resource_categories:read')).toBe(true);
  });

  it('the migration grants the library to zone and general coordinators', () => {
    const migration = stripComments(
      readFileSync(
        join(
          PRISMA_DIR,
          'migrations/20261028120000_coordinator_roles_resources_read/migration.sql',
        ),
        'utf8',
      ),
    );
    expect(migration).toMatch(
      /role_name IN \('zone-coordinator', 'general-coordinator'\)/,
    );
    expect(migration).toMatch(
      /permission_name IN \('resources:read', 'resource_categories:read'\)/,
    );
    expect(migration).toMatch(/ON CONFLICT \(role_id, permission_id\) DO NOTHING/);
  });
});
