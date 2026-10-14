import { AnnualReportsService } from './annual-reports.service';

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
