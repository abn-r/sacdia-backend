import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AUTHORIZATION_RESOURCE_KEY } from '../common/decorators/authorization-resource.decorator';
import { PERMISSIONS_KEY } from '../common/decorators/permissions.decorator';
import { ErrorCode } from '../common/errors/error-codes';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { AuthorizationContextService } from '../common/services/authorization-context.service';
import { InstitutionalHierarchyService } from '../common/services/institutional-hierarchy.service';
import { PrismaService } from '../prisma/prisma.service';
import { AnnualReportsController } from '../annual-reports/annual-reports.controller';
import { MonthlyReportsController } from '../monthly-reports/monthly-reports.controller';
import { QuarterlyReportsController } from '../quarterly-reports/quarterly-reports.controller';

/**
 * reports:update guards the quarterly / annual report mutations (PATCH :id,
 * POST :id/regenerate, POST :id/finalize). Until migration
 * 20261026120000_reports_update_permission the permission did not exist, so
 * the fail-closed PermissionsGuard answered 403 to every role. Platform admins
 * and territorial roles hold it now; coordinators, pastor and CLUB roles never
 * do. Report visibility (territory) is still checked by the service first.
 */

const MUTATIONS = ['updateManualData', 'regenerate', 'finalize'] as const;
type Mutation = (typeof MUTATIONS)[number];

const CONTROLLERS = [
  ['quarterly', QuarterlyReportsController],
  ['annual', AnnualReportsController],
] as const;

const TERRITORIAL_ROLES = [
  'assistant-lf',
  'director-lf',
  'assistant-union',
  'director-union',
  'assistant-dia',
  'director-dia',
] as const;
const ADMIN_ROLES = ['super-admin', 'admin', 'assistant-admin'] as const;
const COORDINATOR_ROLES = [
  'coordinator',
  'zone-coordinator',
  'general-coordinator',
] as const;
const CLUB_ROLES = [
  'secretary',
  'treasurer',
  'secretary-treasurer',
  'deputy-director',
  'director',
] as const;

const USER_ID = '99999999-9999-4999-8999-999999999999';
const globalScope = {
  division: { id: 1 },
  union: { id: 70 },
  local_field: { id: 50 },
};

function globalRoleProfile(roleName: string, permissions: string[]) {
  return {
    authorization: {
      grants: {
        global_roles: [
          { role_name: roleName, permissions, scope: globalScope },
        ],
        club_assignments: [],
        direct_permissions: [],
      },
      active_assignment: { assignment_id: null },
      effective: { permissions, scope: { global: globalScope, club: null } },
    },
  };
}

function clubRoleProfile(roleName: string, permissions: string[]) {
  const club = { club_id: 10, club_name: 'Club Amanecer' };
  const section = { club_section_id: 22, club_type_id: 2 };
  return {
    authorization: {
      grants: {
        global_roles: [],
        club_assignments: [
          {
            assignment_id: 'assignment-1',
            role_name: roleName,
            permissions,
            operational: true,
            club,
            section,
            scope: {},
            status: 'active',
          },
        ],
        direct_permissions: [],
      },
      active_assignment: { assignment_id: 'assignment-1' },
      effective: {
        permissions,
        scope: {
          global: {},
          club: {
            assignment_id: 'assignment-1',
            role_name: roleName,
            club,
            section,
          },
        },
      },
    },
  };
}

function guardFor(profile: unknown) {
  const prisma = {};
  const hierarchy = { resolveCurrent: jest.fn() };
  // REAL authorization context: only the profile loader is replaced.
  const authorizationContext = new AuthorizationContextService(
    prisma as unknown as PrismaService,
    hierarchy as unknown as InstitutionalHierarchyService,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
  );
  jest
    .spyOn(authorizationContext, 'resolveUserAuthorization')
    .mockResolvedValue(profile);
  return new PermissionsGuard(
    new Reflector(),
    authorizationContext,
    prisma as unknown as PrismaService,
    hierarchy as unknown as InstitutionalHierarchyService,
  );
}

function context(
  Controller: (typeof CONTROLLERS)[number][1],
  handler: Mutation,
): ExecutionContext {
  const request = {
    user: { sub: USER_ID },
    params: { id: '5' },
    query: {},
    body: {},
  };
  const proto = Controller.prototype as unknown as Record<string, unknown>;
  return {
    getHandler: () => proto[handler],
    getClass: () => Controller,
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
}

async function decide(
  profile: unknown,
  Controller: (typeof CONTROLLERS)[number][1],
  handler: Mutation,
) {
  try {
    return {
      allowed: await guardFor(profile).canActivate(
        context(Controller, handler),
      ),
    };
  } catch (error) {
    return { allowed: false, code: (error as { code?: string }).code };
  }
}

describe.each(CONTROLLERS)(
  '%s report mutations: metadata',
  (_name, Controller) => {
    const proto = Controller.prototype as unknown as Record<string, object>;

    it.each(MUTATIONS)(
      '%s requires reports:update (all) on an active_assignment resource',
      (handler) => {
        expect(Reflect.getMetadata(PERMISSIONS_KEY, proto[handler])).toEqual({
          permissions: ['reports:update'],
          mode: 'all',
        });
        expect(
          Reflect.getMetadata(AUTHORIZATION_RESOURCE_KEY, proto[handler]),
        ).toEqual({ type: 'active_assignment' });
      },
    );
  },
);

describe.each(CONTROLLERS)(
  '%s report mutations: role access',
  (_name, Controller) => {
    afterEach(() => jest.restoreAllMocks());

    const READ = ['reports:read', 'reports:download'];
    const UPDATE = [...READ, 'reports:submit', 'reports:update'];

    describe.each(MUTATIONS)('%s', (handler) => {
      it.each([...ADMIN_ROLES, ...TERRITORIAL_ROLES])(
        '%s with reports:update PASSES the guard',
        async (role) => {
          expect(
            await decide(globalRoleProfile(role, UPDATE), Controller, handler),
          ).toEqual({ allowed: true });
        },
      );

      it.each(COORDINATOR_ROLES)(
        '%s (reports:read + reports:download) is 403 GUARD_PERMISSION_DENIED',
        async (role) => {
          expect(
            await decide(globalRoleProfile(role, READ), Controller, handler),
          ).toEqual({
            allowed: false,
            code: ErrorCode.GUARD_PERMISSION_DENIED,
          });
        },
      );

      it('pastor (read + reports:submit) is 403', async () => {
        expect(
          await decide(
            globalRoleProfile('pastor', [...READ, 'reports:submit']),
            Controller,
            handler,
          ),
        ).toEqual({ allowed: false, code: ErrorCode.GUARD_PERMISSION_DENIED });
      });

      it('a club director with reports:submit in the active assignment is 403', async () => {
        expect(
          await decide(
            clubRoleProfile('director', [...READ, 'reports:submit']),
            Controller,
            handler,
          ),
        ).toEqual({ allowed: false, code: ErrorCode.GUARD_PERMISSION_DENIED });
      });
    });
  },
);

describe.each(CONTROLLERS)(
  '%s report mutations: controller',
  (_name, Controller) => {
    const req = { user: { sub: 'admin-user' } };
    const build = () => {
      const service = {
        assertReportVisibleToActor: jest.fn().mockResolvedValue(undefined),
        updateManualData: jest.fn().mockResolvedValue({ id: 5 }),
        regenerate: jest.fn().mockResolvedValue({ id: 5 }),
        finalize: jest.fn().mockResolvedValue({ id: 5, status: 'finalized' }),
      };
      const controller = new Controller(service, {});
      return { service, controller };
    };

    it('finalize checks visibility, then finalizes as the actor', async () => {
      const { service, controller } = build();

      await expect(controller.finalize(5, req)).resolves.toEqual({
        status: 'success',
        data: { id: 5, status: 'finalized' },
      });
      expect(service.assertReportVisibleToActor).toHaveBeenCalledWith(
        'admin-user',
        5,
      );
      expect(service.finalize).toHaveBeenCalledWith(5, 'admin-user');
    });

    it('regenerate and PATCH run after the visibility check', async () => {
      const { service, controller } = build();

      await controller.regenerate(5, req);
      await controller.updateManualData(5, {}, req);

      expect(service.assertReportVisibleToActor).toHaveBeenCalledTimes(2);
      expect(service.regenerate).toHaveBeenCalledWith(5);
      expect(service.updateManualData).toHaveBeenCalledWith(5, {});
    });
  },
);

describe('Seed and migration: reports:update and reports:write', () => {
  const stripComments = (sql: string): string =>
    sql
      .split('\n')
      .filter((line) => !line.trim().startsWith('--'))
      .join('\n');
  const read = (path: string) =>
    stripComments(readFileSync(join(__dirname, '../../prisma', path), 'utf8'));
  const migration = read(
    'migrations/20261026120000_reports_update_permission/migration.sql',
  );
  const roleSeed = read('seeds/role-permissions.seed.sql');
  const permissionSeed = read('seeds/permissions.seed.sql');

  const grantStatement = (sql: string): string => {
    const statement = sql
      .split(';')
      .find(
        (s) =>
          s.includes('INSERT INTO role_permissions') &&
          s.includes("p.permission_name = 'reports:update'"),
      );
    expect(statement).toBeDefined();
    return statement as string;
  };

  /** The IN (...) permission list of one role's own seed block. */
  const seedBlock = (role: string): string => {
    const start = roleSeed.indexOf(`WHERE r.role_name = '${role}'`);
    expect(start).toBeGreaterThan(-1);
    return roleSeed.slice(start, roleSeed.indexOf('ON CONFLICT', start));
  };

  it('creates reports:update idempotently in the migration and the permission seed', () => {
    expect(migration).toMatch(
      /INSERT INTO permissions[^;]*'reports:update'[^;]*ON CONFLICT \(permission_name\) DO NOTHING/,
    );
    expect(permissionSeed).toContain("('reports:update',");
  });

  it('the migration grants admins and territorial roles only', () => {
    const grant = grantStatement(migration);
    for (const role of [...ADMIN_ROLES, ...TERRITORIAL_ROLES]) {
      expect(grant).toContain(`'${role}'`);
    }
    for (const role of [...COORDINATOR_ROLES, ...CLUB_ROLES, 'pastor']) {
      expect(grant).not.toContain(`'${role}'`);
    }
    expect(grant).toContain("r.role_category = 'GLOBAL'");
    expect(grant).toContain('ON CONFLICT (role_id, permission_id) DO NOTHING');
  });

  it('the seed re-asserts reports:update for the territorial roles only', () => {
    const grant = grantStatement(roleSeed);
    for (const role of TERRITORIAL_ROLES) {
      expect(grant).toContain(`'${role}'`);
    }
    for (const role of [...COORDINATOR_ROLES, ...CLUB_ROLES, 'pastor']) {
      expect(grant).not.toContain(`'${role}'`);
    }
  });

  it('the seed grant runs after the territorial DELETE + INSERT blocks', () => {
    const grantAt = roleSeed.indexOf("p.permission_name = 'reports:update'");
    for (const role of TERRITORIAL_ROLES) {
      expect(roleSeed.indexOf(`WHERE r.role_name = '${role}'`)).toBeLessThan(
        grantAt,
      );
    }
  });

  it.each(ADMIN_ROLES)(
    'the %s wildcard block does not exclude reports:update',
    (role) => {
      const block = seedBlock(role);
      expect(block).not.toContain("<> 'reports:update'");
      expect(block).not.toMatch(/NOT LIKE '%?reports/);
    },
  );

  it.each([...COORDINATOR_ROLES, ...CLUB_ROLES, 'pastor'])(
    'the %s seed block never lists reports:update',
    (role) => {
      expect(seedBlock(role)).not.toContain("'reports:update'");
    },
  );

  it('creates reports:write idempotently in the migration and the permission seed', () => {
    expect(migration).toMatch(
      /INSERT INTO permissions[^;]*'reports:write'[^;]*ON CONFLICT \(permission_name\) DO NOTHING/,
    );
    expect(permissionSeed).toContain("('reports:write',");
  });

  it('copies reports:write to active reports:submit holders, never coordinators', () => {
    const statements = migration.split(';');
    const roleCopy = statements.find(
      (s) =>
        s.includes('INSERT INTO role_permissions') &&
        s.includes("write_perm.permission_name = 'reports:write'"),
    );
    expect(roleCopy).toContain(
      "submit_perm.permission_name = 'reports:submit'",
    );
    expect(roleCopy).toContain(
      "r.role_name NOT IN ('coordinator', 'zone-coordinator', 'general-coordinator')",
    );
    expect(roleCopy).toContain(
      'ON CONFLICT (role_id, permission_id) DO NOTHING',
    );

    const directCopy = statements.find(
      (s) =>
        s.includes('INSERT INTO users_permissions') &&
        s.includes("write_perm.permission_name = 'reports:write'"),
    );
    expect(directCopy).toContain(
      "submit_perm.permission_name = 'reports:submit'",
    );
    expect(directCopy).toContain(
      'ON CONFLICT (user_id, permission_id) DO NOTHING',
    );
  });

  it.each([...CLUB_ROLES, 'assistant-lf', 'pastor'])(
    'the %s seed block lists reports:write next to reports:submit',
    (role) => {
      const block = seedBlock(role);
      expect(block).toContain("'reports:submit'");
      expect(block).toContain("'reports:write'");
    },
  );

  it.each(COORDINATOR_ROLES)(
    'the %s seed block never lists reports:write',
    (role) => {
      expect(seedBlock(role)).not.toContain("'reports:write'");
    },
  );

  it('monthly regenerate requires reports:write on a monthly_report resource', () => {
    const handler = MonthlyReportsController.prototype.regenerate;
    expect(Reflect.getMetadata(PERMISSIONS_KEY, handler)).toEqual({
      permissions: ['reports:write'],
      mode: 'all',
    });
    expect(Reflect.getMetadata(AUTHORIZATION_RESOURCE_KEY, handler)).toEqual({
      type: 'monthly_report',
      idParam: 'reportId',
    });
  });
});
