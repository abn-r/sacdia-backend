import { GUARDS_METADATA } from '@nestjs/common/constants';
import { AUTHORIZATION_RESOURCE_KEY } from '../common/decorators/authorization-resource.decorator';
import { PERMISSIONS_KEY } from '../common/decorators/permissions.decorator';
import { EXACT_GLOBAL_ROLES_KEY } from '../common/decorators/global-roles.decorator';
import { ErrorCode } from '../common/errors/error-codes';
import { GlobalRolesGuard } from '../common/guards/global-roles.guard';
import { AnnualReportsController } from '../annual-reports/annual-reports.controller';
import { AnnualReportsService } from '../annual-reports/annual-reports.service';
import { QuarterlyReportsController } from '../quarterly-reports/quarterly-reports.controller';
import { QuarterlyReportsService } from '../quarterly-reports/quarterly-reports.service';

/**
 * Quarterly and annual reports belong to a CLUB. Every admin route that takes
 * a report id checks the actor's report visibility first (the same rule as the
 * admin list). Coordinators (coordinator, zone-coordinator, general-coordinator)
 * keep `reports:read` / `reports:download` for monthly reports and compliance,
 * but quarterly and annual reports are not for them: the services answer 403
 * PERIODIC_REPORTS_FORBIDDEN on every route, admin and club.
 */

const coordinatorProfile = (roleName = 'coordinator') =>
  ({
    authorization: {
      grants: {
        global_roles: [
          {
            role_name: roleName,
            permissions: ['reports:read', 'reports:download'],
          },
        ],
        club_assignments: [],
      },
      active_assignment: { assignment_id: null },
      effective: { scope: { global: { local_field: { id: 50 } } } },
    },
  }) as any;

/** A coordinator who is also an active member of a club section. */
const coordinatorWithClubProfile = () => {
  const profile = coordinatorProfile();
  profile.authorization.grants.club_assignments = [
    {
      assignment_id: 'a1',
      role_name: 'director',
      section: { club_section_id: 22 },
    },
  ];
  profile.authorization.active_assignment = { assignment_id: 'a1' };
  return profile;
};

const localFieldDirectorProfile = () =>
  ({
    authorization: {
      grants: {
        global_roles: [
          { role_name: 'director-lf', permissions: ['reports:read'] },
        ],
        club_assignments: [],
      },
      active_assignment: { assignment_id: null },
      effective: { scope: { global: { local_field: { id: 7 } } } },
    },
  }) as any;

type Kind = {
  name: string;
  model: 'quarterly_reports' | 'annual_reports';
  idField: 'quarterly_report_id' | 'annual_report_id';
  notFound: ErrorCode;
  build: (prisma: unknown, auth: unknown) => any;
};

const KINDS: Kind[] = [
  {
    name: 'quarterly',
    model: 'quarterly_reports',
    idField: 'quarterly_report_id',
    notFound: ErrorCode.QUARTERLY_REPORT_NOT_FOUND,
    build: (prisma, auth) =>
      new QuarterlyReportsService(prisma as any, auth as any),
  },
  {
    name: 'annual',
    model: 'annual_reports',
    idField: 'annual_report_id',
    notFound: ErrorCode.ANNUAL_REPORT_NOT_FOUND,
    build: (prisma, auth) =>
      new AnnualReportsService(prisma as any, auth as any),
  },
];

describe.each(KINDS)('$name reports: actor visibility', (kind) => {
  const setup = (profile: unknown, found: boolean) => {
    const prisma = {
      [kind.model]: {
        findFirst: jest
          .fn()
          .mockResolvedValue(found ? { [kind.idField]: 5 } : null),
        count: jest.fn().mockResolvedValue(0),
        findMany: jest.fn().mockResolvedValue([]),
      },
      clubs: {
        findUnique: jest.fn().mockResolvedValue({ club_id: 10, active: true }),
        findFirst: jest.fn().mockResolvedValue({ club_id: 10 }),
      },
    };
    const auth = {
      resolveUserAuthorization: jest.fn().mockResolvedValue(profile),
    };
    return { prisma, service: kind.build(prisma, auth) };
  };

  describe.each(['coordinator', 'zone-coordinator', 'general-coordinator'])(
    '%s',
    (role) => {
      const forbidden = {
        code: ErrorCode.PERIODIC_REPORTS_FORBIDDEN,
        status: 403,
      };

      it('the admin list is 403 PERIODIC_REPORTS_FORBIDDEN and never queries', async () => {
        const { service, prisma } = setup(coordinatorProfile(role), true);

        await expect(
          service.listForAdmin('coord-user', {}),
        ).rejects.toMatchObject(forbidden);
        expect(prisma[kind.model].count).not.toHaveBeenCalled();
        expect(prisma[kind.model].findMany).not.toHaveBeenCalled();
      });

      it('get / PDF by id are 403 too, even for an id that would be in their sections', async () => {
        const { service, prisma } = setup(coordinatorProfile(role), true);

        await expect(
          service.assertReportVisibleToActor('coord-user', 5),
        ).rejects.toMatchObject(forbidden);
        expect(prisma[kind.model].findFirst).not.toHaveBeenCalled();
      });

      it('generate (club) is 403 before the club is looked up', async () => {
        const { service, prisma } = setup(coordinatorProfile(role), true);

        await expect(
          service.assertClubVisibleToActor('coord-user', 10),
        ).rejects.toMatchObject(forbidden);
        expect(prisma.clubs.findUnique).not.toHaveBeenCalled();
      });

      it('club routes (clubs/:clubId/...) apply the same deny', async () => {
        const { service } = setup(coordinatorProfile(role), true);

        await expect(
          service.assertPeriodicReportsAccess('coord-user'),
        ).rejects.toMatchObject(forbidden);
      });
    },
  );

  it('a coordinator who also has a club section keeps that section scope', async () => {
    const { service, prisma } = setup(coordinatorWithClubProfile(), true);

    await expect(
      service.assertReportVisibleToActor('coord-user', 5),
    ).resolves.toBeUndefined();
    await expect(
      service.assertPeriodicReportsAccess('coord-user'),
    ).resolves.toBeUndefined();
    expect(prisma[kind.model].findFirst).toHaveBeenCalledWith({
      where: {
        [kind.idField]: 5,
        club: { club_sections: { some: { club_section_id: 22 } } },
      },
      select: { [kind.idField]: true },
    });
  });

  it('a local-field director is limited to their own field', async () => {
    const { service, prisma } = setup(localFieldDirectorProfile(), true);

    await service.assertReportVisibleToActor('lf-user', 5);
    await expect(
      service.assertPeriodicReportsAccess('lf-user'),
    ).resolves.toBeUndefined();

    expect(prisma[kind.model].findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { [kind.idField]: 5, club: { local_field_id: 7 } },
      }),
    );
  });

  it('answers 404 (not 403) for a report outside a territorial actor scope', async () => {
    const { service } = setup(localFieldDirectorProfile(), false);

    await expect(
      service.assertReportVisibleToActor('lf-user', 5),
    ).rejects.toMatchObject({ code: kind.notFound });
  });

  it('club routes: a report of another club is 404', async () => {
    const { service, prisma } = setup(localFieldDirectorProfile(), false);

    await expect(
      service.assertReportBelongsToClub(10, 5),
    ).rejects.toMatchObject({ code: kind.notFound });
    expect(prisma[kind.model].findFirst).toHaveBeenCalledWith({
      where: { [kind.idField]: 5, club_id: 10 },
      select: { [kind.idField]: true },
    });
  });
});

describe.each([
  ['quarterly', QuarterlyReportsController],
  ['annual', AnnualReportsController],
] as const)('%s reports controller', (_name, Controller) => {
  const proto = Controller.prototype as unknown as Record<string, unknown>;
  const meta = (handler: string) => ({
    permissions: Reflect.getMetadata(PERMISSIONS_KEY, proto[handler] as object)
      ?.permissions,
    resource: Reflect.getMetadata(
      AUTHORIZATION_RESOURCE_KEY,
      proto[handler] as object,
    ),
  });

  it.each([
    ['listAdmin', ['reports:read']],
    ['getAdmin', ['reports:read']],
    ['downloadPdfAdmin', ['reports:download']],
    ['generate', ['reports:update']],
    ['regenerate', ['reports:update']],
  ])(
    'admin route %s declares %j with an active_assignment resource',
    (handler, permissions) => {
      expect(meta(handler)).toEqual({
        permissions,
        resource: { type: 'active_assignment' },
      });
    },
  );

  it.each(['updateManualData', 'finalize'])(
    'the %s route no longer exists',
    (handler) => {
      expect(proto[handler]).toBeUndefined();
    },
  );

  it('regenerate is limited to super-admin and admin (exact roles, GlobalRolesGuard)', () => {
    const handler = proto.regenerate as object;
    expect(Reflect.getMetadata(EXACT_GLOBAL_ROLES_KEY, handler)).toEqual([
      'super-admin',
      'admin',
    ]);
    expect(Reflect.getMetadata(GUARDS_METADATA, handler)).toContain(
      GlobalRolesGuard,
    );
  });

  it('only regenerate carries the global-role guard', () => {
    for (const handler of [
      'listAdmin',
      'getAdmin',
      'generate',
      'downloadPdfAdmin',
    ]) {
      expect(
        Reflect.getMetadata(EXACT_GLOBAL_ROLES_KEY, proto[handler] as object),
      ).toBeUndefined();
    }
  });

  it.each([
    ['listForClub', ['reports:read']],
    ['getForClub', ['reports:read']],
    ['downloadPdfUser', ['reports:download']],
  ])(
    'club route %s declares %j with a club resource',
    (handler, permissions) => {
      expect(meta(handler)).toEqual({
        permissions,
        resource: { type: 'club', clubIdParam: 'clubId' },
      });
    },
  );

  const service = () => ({
    assertReportVisibleToActor: jest
      .fn()
      .mockRejectedValue(Object.assign(new Error('nf'), { code: 'NF' })),
    assertReportBelongsToClub: jest
      .fn()
      .mockRejectedValue(Object.assign(new Error('nf'), { code: 'NF' })),
    assertPeriodicReportsAccess: jest.fn().mockResolvedValue(undefined),
    getReport: jest.fn(),
    refreshDraft: jest.fn(),
    listForClub: jest.fn(),
    regenerate: jest.fn(),
  });
  const pdf = () => ({
    generatePdf: jest.fn(),
    resolveDownloadFilename: jest.fn(),
  });
  const req = { user: { sub: 'actor' } };

  it('admin detail, PDF and regenerate stop at the visibility check', async () => {
    const svc = service();
    const pdfSvc = pdf();
    const controller = new Controller(svc as any, pdfSvc as any);
    const res = { set: jest.fn(), end: jest.fn() };

    await expect(controller.getAdmin(5, req)).rejects.toMatchObject({
      code: 'NF',
    });
    await expect(
      controller.downloadPdfAdmin(5, req, res as any),
    ).rejects.toMatchObject({ code: 'NF' });
    await expect(controller.regenerate(5, req)).rejects.toMatchObject({
      code: 'NF',
    });

    expect(svc.assertReportVisibleToActor).toHaveBeenCalledTimes(3);
    expect(svc.assertReportVisibleToActor).toHaveBeenCalledWith('actor', 5);
    expect(svc.getReport).not.toHaveBeenCalled();
    expect(svc.refreshDraft).not.toHaveBeenCalled();
    expect(pdfSvc.generatePdf).not.toHaveBeenCalled();
    expect(svc.regenerate).not.toHaveBeenCalled();
    expect(res.end).not.toHaveBeenCalled();
  });

  it('club routes deny coordinators first, then check the club in the path', async () => {
    const svc = service();
    const pdfSvc = pdf();
    const controller = new Controller(svc as any, pdfSvc as any);
    const res = { set: jest.fn(), end: jest.fn() };

    await expect(controller.getForClub(10, 5, req)).rejects.toMatchObject({
      code: 'NF',
    });
    await expect(
      controller.downloadPdfUser(10, 5, req, res as any),
    ).rejects.toMatchObject({ code: 'NF' });
    await controller.listForClub(10, req);

    expect(svc.assertPeriodicReportsAccess).toHaveBeenCalledTimes(3);
    expect(svc.assertPeriodicReportsAccess).toHaveBeenCalledWith('actor');
    expect(svc.assertReportBelongsToClub).toHaveBeenCalledWith(10, 5);
    expect(svc.getReport).not.toHaveBeenCalled();
    expect(pdfSvc.generatePdf).not.toHaveBeenCalled();
  });

  it('a coordinator is stopped on the club routes before anything else runs', async () => {
    const svc = service();
    svc.assertPeriodicReportsAccess.mockRejectedValue(
      Object.assign(new Error('forbidden'), { code: 'PERIODIC' }),
    );
    const controller = new Controller(svc as any, pdf() as any);

    await expect(controller.getForClub(10, 5, req)).rejects.toMatchObject({
      code: 'PERIODIC',
    });
    await expect(controller.listForClub(10, req)).rejects.toMatchObject({
      code: 'PERIODIC',
    });
    expect(svc.assertReportBelongsToClub).not.toHaveBeenCalled();
    expect(svc.listForClub).not.toHaveBeenCalled();
  });
});
