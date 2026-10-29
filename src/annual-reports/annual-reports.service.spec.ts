import { AnnualReportsService } from './annual-reports.service';
import { ErrorCode } from '../common/errors/error-codes';

describe('AnnualReportsService admin visibility', () => {
  const mockPrisma = {
    annual_reports: {
      count: jest.fn(),
      findMany: jest.fn(),
    },
  };
  const mockAuthorizationContext = {
    resolveUserAuthorization: jest.fn(),
  };

  const resolvedAuth = () =>
    ({
      authorization: {
        grants: {
          global_roles: [
            { role_name: 'director-lf', permissions: ['reports:read'] },
          ],
          club_assignments: [],
        },
        active_assignment: { assignment_id: null },
        effective: {
          scope: {
            global: { local_field: { id: 7, name: 'Campo' } },
          },
        },
      },
    }) as any;

  beforeEach(() => {
    jest.clearAllMocks();
    mockPrisma.annual_reports.count.mockResolvedValue(0);
    mockPrisma.annual_reports.findMany.mockResolvedValue([]);
  });

  it('forces local-field actors to their own field when listing admin annual reports', async () => {
    mockAuthorizationContext.resolveUserAuthorization.mockResolvedValue(
      resolvedAuth(),
    );
    const service = new AnnualReportsService(
      mockPrisma as any,
      mockAuthorizationContext as any,
      { getEffectiveCoordinatorSectionIds: jest.fn() } as any,
    );

    await service.listForAdmin('director-lf-user', { localFieldId: 99 });

    expect(mockPrisma.annual_reports.count).toHaveBeenCalledWith({
      where: {
        club: {
          local_field_id: 7,
        },
      },
    });
  });
});

describe('AnnualReportsService computeData year boundaries', () => {
  const calendarYear = {
    year_id: 3,
    start_date: new Date('2026-01-01T00:00:00.000Z'),
    end_date: new Date('2026-12-31T00:00:00.000Z'),
  };

  const buildPrisma = (sectionIds: number[]) => ({
    clubs: { findUnique: jest.fn().mockResolvedValue({ club_id: 1 }) },
    ecclesiastical_years: {
      findUnique: jest.fn().mockResolvedValue(calendarYear),
    },
    club_sections: {
      findMany: jest
        .fn()
        .mockResolvedValue(
          sectionIds.map((club_section_id) => ({ club_section_id })),
        ),
    },
    club_role_assignments: {
      count: jest.fn().mockResolvedValue(0),
      findMany: jest.fn().mockResolvedValue([]),
    },
    activities: { count: jest.fn().mockResolvedValue(0) },
    finances: { findMany: jest.fn().mockResolvedValue([]) },
    club_enrollments: { findMany: jest.fn().mockResolvedValue([]) },
    club_annual_rankings: { findFirst: jest.fn().mockResolvedValue(null) },
  });

  const withServerTimezone = async (tz: string, run: () => Promise<void>) => {
    const originalTz = process.env.TZ;
    process.env.TZ = tz;
    try {
      await run();
    } finally {
      process.env.TZ = originalTz;
    }
  };

  it('labels a calendar year by its UTC dates, whatever the server timezone', async () => {
    await withServerTimezone('America/Mexico_City', async () => {
      const service = new AnnualReportsService(
        buildPrisma([]) as any,
        {} as any,
        {} as any,
      );

      const data = await service.computeData(1, calendarYear.year_id);

      expect(data.year_label).toBe('2026–2026');
    });
  });

  it('counts each month once even when several sections reported it', async () => {
    const prisma = buildPrisma([10, 11, 12]);
    prisma.club_enrollments.findMany.mockResolvedValue([
      { club_enrollment_id: 'e1' },
      { club_enrollment_id: 'e2' },
      { club_enrollment_id: 'e3' },
    ]);
    const months = [1, 2, 3, 4, 5, 6];
    const monthly_reports = {
      findMany: jest
        .fn()
        .mockResolvedValue(
          ['e1', 'e2', 'e3'].flatMap(() =>
            months.map((month) => ({ month, year: 2026 })),
          ),
        ),
    };
    const service = new AnnualReportsService(
      { ...prisma, monthly_reports } as any,
      {} as any,
      {} as any,
    );

    const data = await service.computeData(1, calendarYear.year_id);

    expect(data.months_reported).toBe(6);
    expect(monthly_reports.findMany).toHaveBeenCalledWith({
      where: {
        club_enrollment_id: { in: ['e1', 'e2', 'e3'] },
        status: { not: 'draft' },
      },
      select: { month: true, year: true },
    });
  });

  it('keeps the same month of different calendar years apart', async () => {
    const prisma = buildPrisma([10]);
    prisma.club_enrollments.findMany.mockResolvedValue([
      { club_enrollment_id: 'e1' },
    ]);
    const monthly_reports = {
      findMany: jest.fn().mockResolvedValue([
        { month: 12, year: 2025 },
        { month: 12, year: 2026 },
      ]),
    };
    const service = new AnnualReportsService(
      { ...prisma, monthly_reports } as any,
      {} as any,
      {} as any,
    );

    const data = await service.computeData(1, calendarYear.year_id);

    expect(data.months_reported).toBe(2);
  });

  it('aggregates finances for the twelve months of the calendar year, whatever the server timezone', async () => {
    await withServerTimezone('America/Mexico_City', async () => {
      const prisma = buildPrisma([10]);
      const service = new AnnualReportsService(
        prisma as any,
        {} as any,
        {} as any,
      );

      await service.computeData(1, calendarYear.year_id);

      const periods = prisma.finances.findMany.mock.calls.map(
        ([args]) => `${args.where.year}-${args.where.month}`,
      );
      expect(periods).toEqual(
        Array.from({ length: 12 }, (_, i) => `2026-${i + 1}`),
      );
    });
  });
});

describe('AnnualReportsService generate on demand', () => {
  const mockPrisma = {
    clubs: { findUnique: jest.fn(), findFirst: jest.fn() },
    ecclesiastical_years: { findUnique: jest.fn() },
    annual_reports: {
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
  };
  const mockAuthorizationContext = { resolveUserAuthorization: jest.fn() };

  const resolvedAuth = () =>
    ({
      authorization: {
        grants: {
          global_roles: [
            { role_name: 'director-lf', permissions: ['reports:update'] },
          ],
          club_assignments: [],
        },
        active_assignment: { assignment_id: null },
        effective: {
          scope: { global: { local_field: { id: 7, name: 'Campo' } } },
        },
      },
    }) as any;

  const makeService = () =>
    new AnnualReportsService(
      mockPrisma as any,
      mockAuthorizationContext as any,
      { getEffectiveCoordinatorSectionIds: jest.fn() } as any,
    );

  const COMPUTED = { year_label: '2026–2026' } as any;
  const reportRow = (status: string) =>
    ({
      annual_report_id: 5,
      club_id: 10,
      ecclesiastical_year_id: 3,
      status,
    }) as any;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers().setSystemTime(new Date('2026-10-29T18:00:00Z'));
    mockAuthorizationContext.resolveUserAuthorization.mockResolvedValue(
      resolvedAuth(),
    );
    mockPrisma.clubs.findUnique.mockResolvedValue({
      club_id: 10,
      active: true,
    });
    mockPrisma.clubs.findFirst.mockResolvedValue({ club_id: 10 });
    mockPrisma.ecclesiastical_years.findUnique.mockResolvedValue({
      year_id: 3,
      start_date: new Date('2026-01-01T00:00:00.000Z'),
      end_date: new Date('2026-12-31T00:00:00.000Z'),
    });
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('regenerate', () => {
    it('refuses to recompute a finalized report', async () => {
      const service = makeService();
      const computeSpy = jest.spyOn(service, 'computeData');
      mockPrisma.annual_reports.findUnique.mockResolvedValue({
        annual_report_id: 5,
        status: 'finalized',
      });

      await expect(service.regenerate(5)).rejects.toMatchObject({
        response: expect.objectContaining({ code: 'ANNUAL_REPORT_NOT_DRAFT' }),
      });
      expect(computeSpy).not.toHaveBeenCalled();
    });
  });

  describe('generateOnDemand', () => {
    it('creates the draft when missing and computes its data', async () => {
      const service = makeService();
      const computeSpy = jest
        .spyOn(service, 'computeData')
        .mockResolvedValue(COMPUTED);
      mockPrisma.annual_reports.findUnique.mockImplementation(
        ({ where }: any) =>
          Promise.resolve(
            where.annual_report_id === 5 ? reportRow('draft') : null,
          ),
      );
      mockPrisma.annual_reports.create.mockResolvedValue(reportRow('draft'));
      mockPrisma.annual_reports.update.mockResolvedValue({});

      const result = await service.generateOnDemand(10, 3);

      expect(mockPrisma.annual_reports.create).toHaveBeenCalledWith({
        data: { club_id: 10, ecclesiastical_year_id: 3, status: 'draft' },
      });
      expect(computeSpy).toHaveBeenCalledWith(10, 3);
      expect(mockPrisma.annual_reports.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { annual_report_id: 5 },
          data: expect.objectContaining({ computed_data: COMPUTED }),
        }),
      );
      expect(result).toEqual(reportRow('draft'));
    });

    it('recomputes an existing draft', async () => {
      const service = makeService();
      const computeSpy = jest
        .spyOn(service, 'computeData')
        .mockResolvedValue(COMPUTED);
      mockPrisma.annual_reports.findUnique.mockResolvedValue(
        reportRow('draft'),
      );
      mockPrisma.annual_reports.update.mockResolvedValue({});

      await service.generateOnDemand(10, 3);

      expect(mockPrisma.annual_reports.create).not.toHaveBeenCalled();
      expect(computeSpy).toHaveBeenCalledTimes(1);
    });

    it('returns a finalized report without recomputing', async () => {
      const service = makeService();
      const computeSpy = jest.spyOn(service, 'computeData');
      mockPrisma.annual_reports.findUnique.mockResolvedValue(
        reportRow('finalized'),
      );

      const result = await service.generateOnDemand(10, 3);

      expect(computeSpy).not.toHaveBeenCalled();
      expect(mockPrisma.annual_reports.create).not.toHaveBeenCalled();
      expect(mockPrisma.annual_reports.update).not.toHaveBeenCalled();
      expect(result).toEqual(expect.objectContaining({ status: 'finalized' }));
    });

    it('rejects an ecclesiastical year that starts after today', async () => {
      mockPrisma.ecclesiastical_years.findUnique.mockResolvedValue({
        year_id: 4,
        start_date: new Date('2027-01-01T00:00:00.000Z'),
        end_date: new Date('2027-12-31T00:00:00.000Z'),
      });

      await expect(makeService().generateOnDemand(10, 4)).rejects.toMatchObject(
        { code: ErrorCode.REPORT_PERIOD_IN_FUTURE, status: 400 },
      );
      expect(mockPrisma.annual_reports.create).not.toHaveBeenCalled();
    });

    it('answers 404 when the ecclesiastical year does not exist', async () => {
      mockPrisma.ecclesiastical_years.findUnique.mockResolvedValue(null);

      await expect(
        makeService().generateOnDemand(10, 999),
      ).rejects.toMatchObject({
        code: ErrorCode.ANNUAL_REPORT_YEAR_NOT_FOUND,
        status: 404,
      });
    });
  });

  describe('assertClubVisibleToActor', () => {
    it('passes when the club is inside the actor scope', async () => {
      await expect(
        makeService().assertClubVisibleToActor('u1', 10),
      ).resolves.toBeUndefined();
      expect(mockPrisma.clubs.findFirst).toHaveBeenCalledWith({
        where: { club_id: 10, local_field_id: 7 },
        select: { club_id: true },
      });
    });

    it('answers 403 when the club is outside the actor scope', async () => {
      mockPrisma.clubs.findFirst.mockResolvedValue(null);

      await expect(
        makeService().assertClubVisibleToActor('u1', 10),
      ).rejects.toMatchObject({
        code: ErrorCode.GUARD_PERMISSION_DENIED,
        status: 403,
      });
    });

    it('answers 404 when the club does not exist', async () => {
      mockPrisma.clubs.findUnique.mockResolvedValue(null);

      await expect(
        makeService().assertClubVisibleToActor('u1', 999),
      ).rejects.toMatchObject({
        code: ErrorCode.ANNUAL_REPORT_CLUB_NOT_FOUND,
        status: 404,
      });
    });

    it('answers 404 when the club is inactive', async () => {
      mockPrisma.clubs.findUnique.mockResolvedValue({
        club_id: 10,
        active: false,
      });

      await expect(
        makeService().assertClubVisibleToActor('u1', 10),
      ).rejects.toMatchObject({
        code: ErrorCode.ANNUAL_REPORT_CLUB_NOT_FOUND,
        status: 404,
      });
      expect(mockPrisma.clubs.findFirst).not.toHaveBeenCalled();
    });
  });
});
