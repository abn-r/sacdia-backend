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
import { MonthlyReportsController } from './monthly-reports.controller';

/**
 * Coordinator access to monthly reports.
 *
 * GLOBAL coordinator / zone-coordinator / general-coordinator hold reports:read
 * and reports:download (migration 20261025120000_coordinator_reports_read).
 * The detail, PDF and per-enrollment list opt in with `coordinatorSections`:
 * a coordinator passes only when coordinator_assignments cover the report's
 * section. Drafting, editing, generating and submitting need reports:submit,
 * which coordinators never hold, so those routes are 403 for them even inside
 * an assigned section.
 */

const SECTION_ID = 22;
const MAIN_CLUB_ID = 10;
const REPORT_ID = '11111111-1111-4111-8111-111111111111';
const ENROLLMENT_ID = '22222222-2222-4222-8222-222222222222';
const USER_ID = '99999999-9999-4999-8999-999999999999';
const HOME_LOCAL_FIELD = 50;
const OTHER_LOCAL_FIELD = 51;

const COORDINATOR_ROLES = [
  'coordinator',
  'zone-coordinator',
  'general-coordinator',
] as const;
const COORDINATOR_REPORT_PERMISSIONS = ['reports:read', 'reports:download'];

const globalScope = {
  division: { id: 1 },
  union: { id: 70 },
  local_field: { id: HOME_LOCAL_FIELD },
};

function coordinatorProfile(
  roleName: string,
  permissions: string[] = COORDINATOR_REPORT_PERMISSIONS,
) {
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

/** A CLUB role with an ACTIVE assignment in MAIN_CLUB_ID / sectionId. */
function clubRoleProfile(
  roleName: string,
  permissions: string[],
  sectionId: number = SECTION_ID,
  globalRoles: Array<{ role_name: string; permissions: string[] }> = [],
) {
  const club = { club_id: MAIN_CLUB_ID, club_name: 'Club Amanecer' };
  const section = { club_section_id: sectionId, club_type_id: 2 };
  return {
    authorization: {
      grants: {
        global_roles: globalRoles.map((grant) => ({
          ...grant,
          scope: globalScope,
        })),
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

type CoordinatorAssignment = {
  local_field_id: number;
  assignment_type: 'GENERAL' | 'ZONE' | 'SECTION';
  club_section_id: number | null;
};

const sectionAssignment = (clubSectionId: number): CoordinatorAssignment => ({
  local_field_id: HOME_LOCAL_FIELD,
  assignment_type: 'SECTION',
  club_section_id: clubSectionId,
});

const generalAssignment = (): CoordinatorAssignment => ({
  local_field_id: HOME_LOCAL_FIELD,
  assignment_type: 'GENERAL',
  club_section_id: null,
});

/** A row matches a covering clause when every scalar column of it is equal. */
const coveringAssignment =
  (assignments: CoordinatorAssignment[]) =>
  async (args: {
    where: { AND: [unknown, { OR: Array<Record<string, unknown>> }] };
  }): Promise<{ assignment_id: string } | null> => {
    const clauses = args.where.AND[1].OR;
    const hit = assignments.find((row) =>
      clauses.some((clause) =>
        Object.entries(clause).every(
          ([key, value]) =>
            key in row && row[key as keyof CoordinatorAssignment] === value,
        ),
      ),
    );
    return hit ? { assignment_id: 'coordinator-assignment-1' } : null;
  };

function setup(
  profile: unknown,
  {
    assignments = [],
    sectionLocalFieldId = HOME_LOCAL_FIELD,
    clubLocalFieldId = HOME_LOCAL_FIELD,
  }: {
    assignments?: CoordinatorAssignment[];
    sectionLocalFieldId?: number;
    clubLocalFieldId?: number;
  } = {},
) {
  const section = {
    club_section_id: SECTION_ID,
    main_club_id: MAIN_CLUB_ID,
    club_type_id: 2,
  };
  const hierarchy = {
    resolveCurrent: jest.fn().mockResolvedValue({
      division_id: 1,
      union_id: 70,
      local_field_id: clubLocalFieldId,
      club_id: MAIN_CLUB_ID,
      as_of: new Date(),
      source: 'current',
      precision: 'club',
    }),
  };
  const prisma = {
    monthly_reports: {
      findUnique: jest
        .fn()
        .mockResolvedValue({ club_enrollment: { club_section: section } }),
    },
    club_enrollments: {
      findUnique: jest.fn().mockResolvedValue({ club_section: section }),
    },
    coordinator_assignments: {
      findFirst: jest.fn(coveringAssignment(assignments)),
    },
    club_sections: {
      findFirst: jest.fn().mockResolvedValue({
        club_type_id: 2,
        clubs: {
          active: true,
          local_field_id: sectionLocalFieldId,
          districlub_type_id: 7,
        },
      }),
    },
    coordination_zone_districts: { findMany: jest.fn().mockResolvedValue([]) },
  };
  // REAL authorization context: only the profile loader is replaced, so the
  // territory decision (canManageClub) is production code.
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
  const guard = new PermissionsGuard(
    new Reflector(),
    authorizationContext,
    prisma as unknown as PrismaService,
    hierarchy as unknown as InstitutionalHierarchyService,
  );
  return { guard, prisma };
}

type Handler =
  | 'getReport'
  | 'downloadPdf'
  | 'listReports'
  | 'preview'
  | 'getOrCreateDraft'
  | 'updateManualData'
  | 'generate'
  | 'submit'
  | 'regenerate';

const ENROLLMENT_HANDLERS: Handler[] = [
  'listReports',
  'preview',
  'getOrCreateDraft',
];

function context(handler: Handler): ExecutionContext {
  const params: Record<string, string> = ENROLLMENT_HANDLERS.includes(handler)
    ? { enrollmentId: ENROLLMENT_ID }
    : { reportId: REPORT_ID };
  const request = {
    user: { sub: USER_ID },
    params,
    query: { month: '3', year: '2026' },
    body: {},
  };
  return {
    getHandler: () => MonthlyReportsController.prototype[handler],
    getClass: () => MonthlyReportsController,
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
}

const decide = async (guard: PermissionsGuard, handler: Handler) => {
  try {
    return { allowed: await guard.canActivate(context(handler)) };
  } catch (error) {
    return { allowed: false, code: (error as { code?: string }).code };
  }
};

const READ_HANDLERS: Handler[] = ['getReport', 'downloadPdf', 'listReports'];
const MUTATION_HANDLERS: Handler[] = [
  'getOrCreateDraft',
  'updateManualData',
  'generate',
  'submit',
  'regenerate',
];

describe('Monthly reports: coordinator read access (coordinatorSections)', () => {
  afterEach(() => jest.restoreAllMocks());

  describe.each(COORDINATOR_ROLES)('%s', (role) => {
    it.each(READ_HANDLERS)(
      'PASSES %s on a section covered by a SECTION assignment',
      async (handler) => {
        const { guard, prisma } = setup(coordinatorProfile(role), {
          assignments: [sectionAssignment(SECTION_ID)],
        });

        expect(await decide(guard, handler)).toEqual({ allowed: true });
        expect(prisma.coordinator_assignments.findFirst).toHaveBeenCalledWith(
          expect.objectContaining({
            where: expect.objectContaining({ user_id: USER_ID }),
          }),
        );
      },
    );

    it.each(READ_HANDLERS)(
      'PASSES %s through a GENERAL assignment of the club local field',
      async (handler) => {
        const { guard } = setup(coordinatorProfile(role), {
          assignments: [generalAssignment()],
        });

        expect(await decide(guard, handler)).toEqual({ allowed: true });
      },
    );

    it.each(READ_HANDLERS)(
      'is DENIED %s on a section of another local field (no cross-territory read)',
      async (handler) => {
        const { guard } = setup(coordinatorProfile(role), {
          assignments: [sectionAssignment(99), generalAssignment()],
          sectionLocalFieldId: OTHER_LOCAL_FIELD,
          clubLocalFieldId: OTHER_LOCAL_FIELD,
        });

        expect(await decide(guard, handler)).toEqual({
          allowed: false,
          code: ErrorCode.GUARD_CLUB_SCOPE_REQUIRED,
        });
      },
    );

    it.each(READ_HANDLERS)(
      'is DENIED %s without any active assignment (the role is not a territory)',
      async (handler) => {
        const { guard } = setup(coordinatorProfile(role));

        expect(await decide(guard, handler)).toEqual({
          allowed: false,
          code: ErrorCode.GUARD_CLUB_SCOPE_REQUIRED,
        });
      },
    );

    it.each(MUTATION_HANDLERS)(
      'is DENIED %s (403 GUARD_PERMISSION_DENIED) even inside an assigned section',
      async (handler) => {
        const { guard, prisma } = setup(coordinatorProfile(role), {
          assignments: [sectionAssignment(SECTION_ID), generalAssignment()],
        });

        expect(await decide(guard, handler)).toEqual({
          allowed: false,
          code: ErrorCode.GUARD_PERMISSION_DENIED,
        });
        // Denied on the permission, before any scope lookup.
        expect(prisma.coordinator_assignments.findFirst).not.toHaveBeenCalled();
      },
    );

    it('preview did not opt in: a covering assignment does not open it', async () => {
      const { guard } = setup(coordinatorProfile(role), {
        assignments: [sectionAssignment(SECTION_ID)],
      });

      expect(await decide(guard, 'preview')).toEqual({
        allowed: false,
        code: ErrorCode.GUARD_CLUB_SCOPE_REQUIRED,
      });
    });
  });

  it('a coordinator who is a plain MEMBER of the section reads it only through an assignment', async () => {
    const memberCoordinator = clubRoleProfile(
      'member',
      ['clubs:read'],
      SECTION_ID,
      [
        {
          role_name: 'coordinator',
          permissions: COORDINATOR_REPORT_PERMISSIONS,
        },
      ],
    );

    const withoutAssignment = setup(memberCoordinator);
    expect(await decide(withoutAssignment.guard, 'getReport')).toEqual({
      allowed: false,
      code: ErrorCode.GUARD_CLUB_SCOPE_REQUIRED,
    });

    const withAssignment = setup(memberCoordinator, {
      assignments: [sectionAssignment(SECTION_ID)],
    });
    expect(await decide(withAssignment.guard, 'getReport')).toEqual({
      allowed: true,
    });
    expect(await decide(withAssignment.guard, 'submit')).toEqual({
      allowed: false,
      code: ErrorCode.GUARD_PERMISSION_DENIED,
    });
  });
});

describe('Monthly reports: club roles keep drafting and submitting with reports:submit', () => {
  afterEach(() => jest.restoreAllMocks());

  const DIRECTOR_PERMISSIONS = [
    'reports:read',
    'reports:download',
    'reports:submit',
  ];

  it.each([
    'getOrCreateDraft',
    'updateManualData',
    'generate',
    'submit',
  ] as Handler[])(
    'a director PASSES %s in their own section',
    async (handler) => {
      const { guard } = setup(
        clubRoleProfile('director', DIRECTOR_PERMISSIONS),
      );

      expect(await decide(guard, handler)).toEqual({ allowed: true });
    },
  );

  it.each([
    'getOrCreateDraft',
    'updateManualData',
    'generate',
    'submit',
  ] as Handler[])('reports:read alone no longer opens %s', async (handler) => {
    const { guard } = setup(
      clubRoleProfile('director', ['reports:read', 'reports:download']),
    );

    expect(await decide(guard, handler)).toEqual({
      allowed: false,
      code: ErrorCode.GUARD_PERMISSION_DENIED,
    });
  });

  it('a director is DENIED in another section of the same club', async () => {
    const { guard } = setup(
      clubRoleProfile('director', DIRECTOR_PERMISSIONS, 23),
    );

    expect(await decide(guard, 'submit')).toEqual({
      allowed: false,
      code: ErrorCode.GUARD_CLUB_SCOPE_REQUIRED,
    });
  });
});

describe('Monthly reports controller metadata', () => {
  const metadata = (handler: Handler) => ({
    permissions: Reflect.getMetadata(
      PERMISSIONS_KEY,
      MonthlyReportsController.prototype[handler],
    ),
    resource: Reflect.getMetadata(
      AUTHORIZATION_RESOURCE_KEY,
      MonthlyReportsController.prototype[handler],
    ),
  });

  it.each([
    'getOrCreateDraft',
    'updateManualData',
    'generate',
    'submit',
  ] as Handler[])(
    '%s requires reports:submit and never opts into coordinatorSections',
    (handler) => {
      const { permissions, resource } = metadata(handler);
      expect(permissions).toEqual({
        permissions: ['reports:submit'],
        mode: 'all',
      });
      expect(resource.type).toBe('monthly_report');
      expect(resource.coordinatorSections).toBeUndefined();
    },
  );

  it.each([
    ['getReport', 'reports:read', 'reportId'],
    ['downloadPdf', 'reports:download', 'reportId'],
    ['listReports', 'reports:read', 'enrollmentId'],
  ] as Array<[Handler, string, string]>)(
    '%s requires %s and opts into coordinatorSections',
    (handler, permission, idParam) => {
      expect(metadata(handler)).toEqual({
        permissions: { permissions: [permission], mode: 'all' },
        resource: {
          type: 'monthly_report',
          idParam,
          coordinatorSections: true,
        },
      });
    },
  );
});

describe('Seed and migration: coordinators read reports, never submit', () => {
  const stripComments = (sql: string): string =>
    sql
      .split('\n')
      .filter((line) => !line.trim().startsWith('--'))
      .join('\n');
  const migration = stripComments(
    readFileSync(
      join(
        __dirname,
        '../../prisma/migrations/20261025120000_coordinator_reports_read/migration.sql',
      ),
      'utf8',
    ),
  );
  const roleSeed = stripComments(
    readFileSync(
      join(__dirname, '../../prisma/seeds/role-permissions.seed.sql'),
      'utf8',
    ),
  );
  const permissionSeed = readFileSync(
    join(__dirname, '../../prisma/seeds/permissions.seed.sql'),
    'utf8',
  );

  /** The IN (...) permission list of one role's seed block. */
  const seedBlock = (role: string): string => {
    const start = roleSeed.indexOf(`WHERE r.role_name = '${role}'`);
    expect(start).toBeGreaterThan(-1);
    const end = roleSeed.indexOf('ON CONFLICT', start);
    return roleSeed.slice(start, end);
  };

  it('creates reports:submit in the migration and the permission seed', () => {
    expect(migration).toMatch(
      /INSERT INTO permissions[^;]*'reports:submit'[^;]*ON CONFLICT \(permission_name\) DO NOTHING/,
    );
    expect(permissionSeed).toContain("('reports:submit',");
  });

  it('copies reports:submit only to non-coordinator holders of reports:read', () => {
    const copy = migration
      .split(';')
      .find(
        (statement) =>
          statement.includes('INSERT INTO role_permissions') &&
          statement.includes("read_perm.permission_name = 'reports:read'"),
      );
    expect(copy).toBeDefined();
    expect(copy).toContain(
      "r.role_name NOT IN ('coordinator', 'zone-coordinator', 'general-coordinator')",
    );
  });

  it('grants the coordinator trio reports:read + reports:download only', () => {
    const grant = migration
      .split(';')
      .find((statement) =>
        statement.includes(
          "r.role_name IN ('coordinator', 'zone-coordinator', 'general-coordinator')",
        ),
      );
    expect(grant).toContain(
      "p.permission_name IN ('reports:read', 'reports:download')",
    );
    expect(grant).not.toContain('reports:submit');
  });

  it('copies before granting, so coordinators never receive reports:submit', () => {
    expect(
      migration.indexOf("read_perm.permission_name = 'reports:read'"),
    ).toBeLessThan(
      migration.indexOf(
        "p.permission_name IN ('reports:read', 'reports:download')",
      ),
    );
  });

  it.each(COORDINATOR_ROLES)(
    'the %s seed block lists reports:read and reports:download, never reports:submit',
    (role) => {
      const block = seedBlock(role);
      expect(block).toContain("'reports:read'");
      expect(block).toContain("'reports:download'");
      expect(block).not.toContain("'reports:submit'");
    },
  );

  it.each([
    'secretary',
    'treasurer',
    'secretary-treasurer',
    'deputy-director',
    'director',
    'assistant-lf',
    'pastor',
  ])('the %s seed block keeps reports:read AND gets reports:submit', (role) => {
    const block = seedBlock(role);
    expect(block).toContain("'reports:read'");
    expect(block).toContain("'reports:submit'");
  });
});
