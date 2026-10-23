import { AUTHORIZATION_RESOURCE_KEY } from '../common/decorators/authorization-resource.decorator';
import { PERMISSIONS_KEY } from '../common/decorators/permissions.decorator';
import { ErrorCode } from '../common/errors/error-codes';
import { AnnualReportsController } from '../annual-reports/annual-reports.controller';
import { AnnualReportsService } from '../annual-reports/annual-reports.service';
import { QuarterlyReportsController } from '../quarterly-reports/quarterly-reports.controller';
import { QuarterlyReportsService } from '../quarterly-reports/quarterly-reports.service';

/**
 * Quarterly and annual reports belong to a CLUB. Every admin route that takes
 * a report id checks the actor's report visibility first (the same rule as the
 * admin list); a coordinator sees a club's reports when one of its sections is
 * in their coordinator scope. Outside that scope the answer is 404, so ids
 * cannot be probed. Club routes check the club in the path.
 */

const COORDINATOR_SECTIONS = [22, 23];

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
  build: (prisma: unknown, auth: unknown, coordination: unknown) => any;
};

const KINDS: Kind[] = [
  {
    name: 'quarterly',
    model: 'quarterly_reports',
    idField: 'quarterly_report_id',
    notFound: ErrorCode.QUARTERLY_REPORT_NOT_FOUND,
    build: (prisma, auth, coordination) =>
      new QuarterlyReportsService(
        prisma as any,
        auth as any,
        coordination as any,
      ),
  },
  {
    name: 'annual',
    model: 'annual_reports',
    idField: 'annual_report_id',
    notFound: ErrorCode.ANNUAL_REPORT_NOT_FOUND,
    build: (prisma, auth, coordination) =>
      new AnnualReportsService(prisma as any, auth as any, coordination as any),
  },
];

describe.each(KINDS)('$name reports: actor visibility', (kind) => {
  const setup = (profile: unknown, found: boolean) => {
    const prisma = {
      [kind.model]: {
        findFirst: jest
          .fn()
          .mockResolvedValue(found ? { [kind.idField]: 5 } : null),
      },
    };
    const auth = {
      resolveUserAuthorization: jest.fn().mockResolvedValue(profile),
    };
    const coordination = {
      getEffectiveCoordinatorSectionIds: jest
        .fn()
        .mockResolvedValue(COORDINATOR_SECTIONS),
    };
    return {
      prisma,
      coordination,
      service: kind.build(prisma, auth, coordination),
    };
  };

  it.each(['coordinator', 'zone-coordinator', 'general-coordinator'])(
    '%s: the report must belong to a club with a section in their coordinator scope',
    async (role) => {
      const { service, prisma, coordination } = setup(
        coordinatorProfile(role),
        true,
      );

      await expect(
        service.assertReportVisibleToActor('coord-user', 5),
      ).resolves.toBeUndefined();

      expect(
        coordination.getEffectiveCoordinatorSectionIds,
      ).toHaveBeenCalledWith('coord-user');
      expect(prisma[kind.model].findFirst).toHaveBeenCalledWith({
        where: {
          [kind.idField]: 5,
          club: {
            club_sections: {
              some: { club_section_id: { in: COORDINATOR_SECTIONS } },
            },
          },
        },
        select: { [kind.idField]: true },
      });
    },
  );

  it('answers 404 (not 403) for a report outside the coordinator scope', async () => {
    const { service } = setup(coordinatorProfile(), false);

    await expect(
      service.assertReportVisibleToActor('coord-user', 5),
    ).rejects.toMatchObject({ code: kind.notFound });
  });

  it('a coordinator without assignments is 403 ADMIN_USER_SCOPE_MISSING', async () => {
    const { service, coordination } = setup(coordinatorProfile(), true);
    coordination.getEffectiveCoordinatorSectionIds.mockResolvedValue([]);

    await expect(
      service.assertReportVisibleToActor('coord-user', 5),
    ).rejects.toMatchObject({ code: ErrorCode.ADMIN_USER_SCOPE_MISSING });
  });

  it('a local-field director is limited to their own field', async () => {
    const { service, prisma } = setup(localFieldDirectorProfile(), true);

    await service.assertReportVisibleToActor('lf-user', 5);

    expect(prisma[kind.model].findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { [kind.idField]: 5, club: { local_field_id: 7 } },
      }),
    );
  });

  it('club routes: a report of another club is 404', async () => {
    const { service, prisma } = setup(coordinatorProfile(), false);

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
    ['updateManualData', ['reports:update']],
    ['regenerate', ['reports:update']],
    ['finalize', ['reports:update']],
  ])(
    'admin route %s declares %j with an active_assignment resource',
    (handler, permissions) => {
      expect(meta(handler)).toEqual({
        permissions,
        resource: { type: 'active_assignment' },
      });
    },
  );

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
    getReport: jest.fn(),
    updateManualData: jest.fn(),
    regenerate: jest.fn(),
    finalize: jest.fn(),
  });
  const pdf = () => ({
    generatePdf: jest.fn(),
    resolveDownloadFilename: jest.fn(),
  });
  const req = { user: { sub: 'actor' } };

  it('admin detail, PDF and mutations stop at the visibility check', async () => {
    const svc = service();
    const pdfSvc = pdf();
    const controller = new Controller(svc, pdfSvc);
    const res = { set: jest.fn(), end: jest.fn() };

    await expect(controller.getAdmin(5, req)).rejects.toMatchObject({
      code: 'NF',
    });
    await expect(
      controller.downloadPdfAdmin(5, req, res),
    ).rejects.toMatchObject({ code: 'NF' });
    await expect(controller.updateManualData(5, {}, req)).rejects.toMatchObject(
      { code: 'NF' },
    );
    await expect(controller.regenerate(5, req)).rejects.toMatchObject({
      code: 'NF',
    });
    await expect(controller.finalize(5, req)).rejects.toMatchObject({
      code: 'NF',
    });

    expect(svc.assertReportVisibleToActor).toHaveBeenCalledTimes(5);
    expect(svc.assertReportVisibleToActor).toHaveBeenCalledWith('actor', 5);
    expect(svc.getReport).not.toHaveBeenCalled();
    expect(pdfSvc.generatePdf).not.toHaveBeenCalled();
    expect(svc.updateManualData).not.toHaveBeenCalled();
    expect(svc.regenerate).not.toHaveBeenCalled();
    expect(svc.finalize).not.toHaveBeenCalled();
    expect(res.end).not.toHaveBeenCalled();
  });

  it('club detail and PDF check the club in the path first', async () => {
    const svc = service();
    const pdfSvc = pdf();
    const controller = new Controller(svc, pdfSvc);
    const res = { set: jest.fn(), end: jest.fn() };

    await expect(controller.getForClub(10, 5)).rejects.toMatchObject({
      code: 'NF',
    });
    await expect(controller.downloadPdfUser(10, 5, res)).rejects.toMatchObject({
      code: 'NF',
    });

    expect(svc.assertReportBelongsToClub).toHaveBeenCalledWith(10, 5);
    expect(svc.getReport).not.toHaveBeenCalled();
    expect(pdfSvc.generatePdf).not.toHaveBeenCalled();
  });
});
