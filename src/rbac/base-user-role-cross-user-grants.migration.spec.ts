import 'reflect-metadata';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { METHOD_METADATA } from '@nestjs/common/constants';
import {
  AUTHORIZATION_RESOURCE_KEY,
  type AuthorizationResourceMetadata,
} from '../common/decorators/authorization-resource.decorator';
import {
  PERMISSIONS_KEY,
  type PermissionRequirement,
} from '../common/decorators/permissions.decorator';
import { IS_PUBLIC_KEY } from '../common/decorators/public.decorator';
import {
  SENSITIVE_USER_SUBRESOURCE_KEY,
  type SensitiveUserSubresourceMetadata,
} from '../common/decorators/sensitive-user-subresource.decorator';
import { SKIP_PERMISSIONS_KEY } from '../common/decorators/skip-permissions.decorator';
import { getSensitiveUserSubresourceFallbackPermission } from '../common/guards/sensitive-user-subresource-policy';

const PRISMA_DIR = join(__dirname, '../../prisma');
const MIGRATION_NAME = '20261016100000_base_user_role_drop_cross_user_grants';

/** Base-role grants that only ever served cross-user (BOLA) access. */
const REMOVED_PERMISSIONS = [
  'users:update_profile',
  'emergency_contacts:read',
  'emergency_contacts:update',
  'health:read',
  'health:update',
  'legal_representative:read',
  'legal_representative:update',
  'post_registration:read',
  'user_honors:read',
  'user_honors:create',
  'user_honors:submit',
  'user_honors:delete',
] as const;

/** Base-role grants that must survive (global / club-scoped / UI gating). */
const KEPT_PERMISSIONS = [
  'users:read',
  'classes:read',
  'catalogs:read',
  'certifications:read',
  'clubs:read',
  'club_sections:read',
  'requests:read',
  'dashboard:read',
  'achievements:read',
  'validation:read',
] as const;

const stripComments = (sql: string): string =>
  sql
    .split('\n')
    .filter((line) => !line.trim().startsWith('--'))
    .join('\n');

const statementsOf = (sql: string): string[] =>
  stripComments(sql)
    .split(';')
    .map((part) => part.replace(/\s+/g, ' ').trim())
    .filter((part) => part.length > 0);

const permissionLiterals = (sql: string): string[] =>
  [...sql.matchAll(/'([a-z_]+:[a-z_]+)'/g)].map((match) => match[1]);

const ALLOWED_STATEMENT =
  /^DELETE FROM role_permissions USING roles r, permissions p WHERE role_permissions\.role_id = r\.role_id AND role_permissions\.permission_id = p\.permission_id AND r\.role_name = 'user' AND r\.role_category = 'GLOBAL' AND p\.permission_name IN \( ?('[a-z_]+:[a-z_]+'(, )?)+ ?\)$/;

const DENIED_PATTERNS: RegExp[] = [
  /\b(BEGIN|COMMIT|ROLLBACK)\b/i,
  /\b(DROP|TRUNCATE|ALTER|CREATE|INSERT)\b/i,
  /\bUPDATE\s+\w+\s+SET\b/i,
  /\bCONCURRENTLY\b/i,
  /\busers_permissions\b/i,
  /DELETE FROM (permissions|roles)\b/i,
  /\b(I?LIKE)\b|~/i,
];

/** Allowlist/denylist guard; empty result = migration is safe. */
function findViolations(sql: string): string[] {
  const violations: string[] = [];
  for (const statement of statementsOf(sql)) {
    if (!ALLOWED_STATEMENT.test(statement)) {
      violations.push(`not allowlisted: ${statement.slice(0, 60)}`);
    }
  }
  // Literals blanked so a code like 'user_honors:create' is not read as DDL.
  const ddl = stripComments(sql).replace(/'[^']*'/g, "''");
  for (const denied of DENIED_PATTERNS) {
    if (denied.test(ddl)) {
      violations.push(`denied: ${denied.source}`);
    }
  }
  return violations;
}

const migration = readFileSync(
  join(PRISMA_DIR, 'migrations', MIGRATION_NAME, 'migration.sql'),
  'utf8',
);

describe(`base user role cross-user grants migration (${MIGRATION_NAME})`, () => {
  it('passes the allowlist/denylist guard', () => {
    expect(findViolations(migration)).toEqual([]);
  });

  it('is a single DELETE scoped to the GLOBAL base user role', () => {
    expect(statementsOf(migration)).toHaveLength(1);
  });

  it('targets exactly the cross-user permissions and none of the kept ones', () => {
    const literals = permissionLiterals(stripComments(migration));
    expect(literals).toHaveLength(REMOVED_PERMISSIONS.length);
    expect(new Set(literals)).toEqual(new Set(REMOVED_PERMISSIONS));
    for (const kept of KEPT_PERMISSIONS) {
      expect(literals).not.toContain(kept);
    }
  });

  describe('guard negative cases', () => {
    it.each([
      [
        'another role',
        migration.replace("r.role_name = 'user'", "r.role_name = 'member'"),
      ],
      [
        'no category filter',
        migration.replace("AND r.role_category = 'GLOBAL'", ''),
      ],
      ['transaction control', `BEGIN;\n${migration}\nCOMMIT;`],
      [
        'direct user grants',
        `${migration}\nDELETE FROM users_permissions WHERE true;`,
      ],
      [
        'permission catalog',
        `${migration}\nDELETE FROM permissions WHERE true;`,
      ],
      [
        'pattern match',
        migration.replace(
          "'health:read'",
          "'health:%' OR p.permission_name LIKE 'x'",
        ),
      ],
      ['re-grant', `${migration}\nINSERT INTO role_permissions SELECT 1;`],
    ])('rejects %s', (_label, sql) => {
      expect(findViolations(sql)).not.toEqual([]);
    });
  });
});

describe('role-permissions seed keeps the base user role off cross-user routes', () => {
  const seed = stripComments(
    readFileSync(
      join(PRISMA_DIR, 'seeds', 'role-permissions.seed.sql'),
      'utf8',
    ),
  );
  const baseRoleGrants = new Set(
    statementsOf(seed)
      .filter(
        (statement) =>
          statement.startsWith('INSERT INTO role_permissions') &&
          statement.includes("r.role_name = 'user'"),
      )
      .flatMap(permissionLiterals),
  );

  it('grants none of the removed permissions', () => {
    for (const removed of REMOVED_PERMISSIONS) {
      expect({ removed, granted: baseRoleGrants.has(removed) }).toEqual({
        removed,
        granted: false,
      });
    }
  });

  it('still grants the kept permissions', () => {
    for (const kept of KEPT_PERMISSIONS) {
      expect(baseRoleGrants.has(kept)).toBe(true);
    }
  });

  describe('against the real route metadata', () => {
    type RouteAuth = {
      route: string;
      ownerAware: boolean;
      permissions: string[];
    };

    const collectRoutes = (): RouteAuth[] => {
      const files: string[] = [];
      const walk = (dir: string): void => {
        for (const entry of readdirSync(dir, { withFileTypes: true })) {
          const path = join(dir, entry.name);
          if (entry.isDirectory()) walk(path);
          else if (entry.name.endsWith('.controller.ts')) files.push(path);
        }
      };
      walk(join(__dirname, '..'));

      const routes: RouteAuth[] = [];
      for (const file of files) {
        const exported = require(file) as Record<string, unknown>;
        for (const candidate of Object.values(exported)) {
          if (typeof candidate !== 'function') continue;
          const controller = candidate as {
            name: string;
            prototype: Record<string, unknown>;
          };
          for (const name of Object.getOwnPropertyNames(controller.prototype)) {
            const handler = controller.prototype[name];
            if (name === 'constructor' || typeof handler !== 'function') {
              continue;
            }
            if (Reflect.getMetadata(METHOD_METADATA, handler) === undefined) {
              continue;
            }
            const meta = <T>(key: string): T | undefined =>
              (Reflect.getMetadata(key, handler) ??
                Reflect.getMetadata(key, controller)) as T | undefined;
            if (
              meta<boolean>(IS_PUBLIC_KEY) ||
              meta<boolean>(SKIP_PERMISSIONS_KEY)
            ) {
              continue;
            }
            const requirement = meta<PermissionRequirement>(PERMISSIONS_KEY);
            const resource = meta<AuthorizationResourceMetadata>(
              AUTHORIZATION_RESOURCE_KEY,
            );
            if (!requirement || !resource) continue;
            const sensitive = meta<SensitiveUserSubresourceMetadata>(
              SENSITIVE_USER_SUBRESOURCE_KEY,
            );
            routes.push({
              route: `${controller.name}.${name}`,
              ownerAware:
                resource.type === 'user' ||
                (resource.type === 'active_assignment' &&
                  Boolean(resource.ownerParam)),
              permissions: [
                ...requirement.permissions,
                ...(sensitive
                  ? [
                      getSensitiveUserSubresourceFallbackPermission(
                        sensitive.family,
                        sensitive.mode,
                      ),
                    ]
                  : []),
              ],
            });
          }
        }
      }
      return routes;
    };

    let routes: RouteAuth[];
    beforeAll(() => {
      routes = collectRoutes();
    }, 120_000);

    it('finds the owner-aware user routes', () => {
      expect(routes.filter((route) => route.ownerAware).length).toBeGreaterThan(
        40,
      );
    });

    it('grants the base role no permission that only owner-aware routes use', () => {
      const crossUserOnly = [...baseRoleGrants].filter((permission) => {
        const users = routes.filter((route) =>
          route.permissions.includes(permission),
        );
        return users.length > 0 && users.every((route) => route.ownerAware);
      });
      expect(crossUserOnly).toEqual([]);
    });

    it('removes only permissions whose routes are all owner-aware', () => {
      for (const removed of REMOVED_PERMISSIONS) {
        const users = routes.filter((route) =>
          route.permissions.includes(removed),
        );
        expect({ removed, used: users.length > 0 }).toEqual({
          removed,
          used: true,
        });
        expect({
          removed,
          nonOwnerAware: users
            .filter((route) => !route.ownerAware)
            .map((route) => route.route),
        }).toEqual({ removed, nonOwnerAware: [] });
      }
    });
  });
});
