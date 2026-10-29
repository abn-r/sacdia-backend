import { QuarterlyReportsService } from './quarterly-reports.service';
import { ErrorCode } from '../common/errors/error-codes';

describe('QuarterlyReportsService admin visibility', () => {
  const mockPrisma = {
    quarterly_reports: {
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
            { role_name: 'director-union', permissions: ['reports:read'] },
          ],
          club_assignments: [],
        },
        active_assignment: { assignment_id: null },
        effective: {
          scope: {
            global: { union: { id: 20, name: 'Unión' } },
          },
        },
      },
    }) as any;

  beforeEach(() => {
    jest.clearAllMocks();
    mockPrisma.quarterly_reports.count.mockResolvedValue(0);
    mockPrisma.quarterly_reports.findMany.mockResolvedValue([]);
  });

  it('forces union-tier actors to their own union when listing admin quarterly reports', async () => {
    mockAuthorizationContext.resolveUserAuthorization.mockResolvedValue(
      resolvedAuth(),
    );
    const service = new QuarterlyReportsService(
      mockPrisma as any,
      mockAuthorizationContext as any,
      { getEffectiveCoordinatorSectionIds: jest.fn() } as any,
    );

    await service.listForAdmin('director-union-user', {
      unionId: 99,
      localFieldId: 7,
    });

    expect(mockPrisma.quarterly_reports.count).toHaveBeenCalledWith({
      where: {
        club: {
          local_field_id: 7,
          local_fields: { union_id: 20 },
        },
      },
    });
  });
});

describe('QuarterlyReportsService generate on demand', () => {
  const mockPrisma = {
    clubs: { findUnique: jest.fn(), findFirst: jest.fn() },
    quarterly_reports: {
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
            { role_name: 'director-union', permissions: ['reports:update'] },
          ],
          club_assignments: [],
        },
        active_assignment: { assignment_id: null },
        effective: { scope: { global: { union: { id: 20, name: 'Unión' } } } },
      },
    }) as any;

  const makeService = () =>
    new QuarterlyReportsService(
      mockPrisma as any,
      mockAuthorizationContext as any,
      { getEffectiveCoordinatorSectionIds: jest.fn() } as any,
    );

  const COMPUTED = { quarter_label: 'Q2 2026' } as any;
  const FULL_REPORT = {
    quarterly_report_id: 5,
    club_id: 10,
    year: 2026,
    quarter: 2,
    status: 'draft',
  } as any;

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
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('generateOnDemand', () => {
    it('creates the draft when missing and computes its data', async () => {
      const service = makeService();
      const computeSpy = jest
        .spyOn(service, 'computeData')
        .mockResolvedValue(COMPUTED);
      mockPrisma.quarterly_reports.findUnique.mockImplementation(
        ({ where }: any) => {
          if (where.club_id_year_quarter) return Promise.resolve(null);
          return Promise.resolve(
            where.quarterly_report_id === 5 ? FULL_REPORT : null,
          );
        },
      );
      mockPrisma.quarterly_reports.create.mockResolvedValue({
        quarterly_report_id: 5,
        status: 'draft',
      });
      mockPrisma.quarterly_reports.update.mockResolvedValue({});

      const result = await service.generateOnDemand(10, 2026, 2);

      expect(mockPrisma.quarterly_reports.create).toHaveBeenCalledWith({
        data: { club_id: 10, year: 2026, quarter: 2, status: 'draft' },
      });
      expect(computeSpy).toHaveBeenCalledWith(10, 2026, 2);
      expect(mockPrisma.quarterly_reports.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { quarterly_report_id: 5 },
          data: expect.objectContaining({ computed_data: COMPUTED }),
        }),
      );
      expect(result).toBe(FULL_REPORT);
    });

    it('recomputes an existing draft', async () => {
      const service = makeService();
      const computeSpy = jest
        .spyOn(service, 'computeData')
        .mockResolvedValue(COMPUTED);
      mockPrisma.quarterly_reports.findUnique.mockResolvedValue({
        quarterly_report_id: 5,
        club_id: 10,
        year: 2026,
        quarter: 2,
        status: 'draft',
      });
      mockPrisma.quarterly_reports.update.mockResolvedValue({});

      await service.generateOnDemand(10, 2026, 2);

      expect(mockPrisma.quarterly_reports.create).not.toHaveBeenCalled();
      expect(computeSpy).toHaveBeenCalledTimes(1);
      expect(mockPrisma.quarterly_reports.update).toHaveBeenCalledTimes(1);
    });

    it('returns a finalized report without recomputing', async () => {
      const service = makeService();
      const computeSpy = jest.spyOn(service, 'computeData');
      mockPrisma.quarterly_reports.findUnique.mockResolvedValue({
        quarterly_report_id: 5,
        club_id: 10,
        year: 2026,
        quarter: 2,
        status: 'finalized',
      });

      const result = await service.generateOnDemand(10, 2026, 2);

      expect(computeSpy).not.toHaveBeenCalled();
      expect(mockPrisma.quarterly_reports.create).not.toHaveBeenCalled();
      expect(mockPrisma.quarterly_reports.update).not.toHaveBeenCalled();
      expect(result).toEqual(expect.objectContaining({ status: 'finalized' }));
    });

    it('rejects a quarter that starts after today', async () => {
      const service = makeService();

      await expect(service.generateOnDemand(10, 2027, 1)).rejects.toMatchObject(
        { code: ErrorCode.REPORT_PERIOD_IN_FUTURE, status: 400 },
      );
      expect(mockPrisma.quarterly_reports.create).not.toHaveBeenCalled();
    });

    it('allows the quarter in progress', async () => {
      const service = makeService();
      jest.spyOn(service, 'computeData').mockResolvedValue(COMPUTED);
      mockPrisma.quarterly_reports.findUnique.mockResolvedValue({
        quarterly_report_id: 5,
        club_id: 10,
        year: 2026,
        quarter: 4,
        status: 'draft',
      });
      mockPrisma.quarterly_reports.update.mockResolvedValue({});

      await expect(
        service.generateOnDemand(10, 2026, 4),
      ).resolves.toBeDefined();
    });

    it('uses the Mexico City calendar day at the quarter boundary', async () => {
      // 2026-10-01 03:00 UTC is still 2026-09-30 in America/Mexico_City.
      jest.setSystemTime(new Date('2026-10-01T03:00:00Z'));
      const service = makeService();

      await expect(service.generateOnDemand(10, 2026, 4)).rejects.toMatchObject(
        { code: ErrorCode.REPORT_PERIOD_IN_FUTURE },
      );
    });
  });

  describe('assertClubVisibleToActor', () => {
    it('passes when the club is inside the actor scope', async () => {
      await expect(
        makeService().assertClubVisibleToActor('u1', 10),
      ).resolves.toBeUndefined();
      expect(mockPrisma.clubs.findFirst).toHaveBeenCalledWith({
        where: {
          club_id: 10,
          local_fields: { union_id: 20 },
        },
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
        code: ErrorCode.QUARTERLY_REPORT_CLUB_NOT_FOUND,
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
        code: ErrorCode.QUARTERLY_REPORT_CLUB_NOT_FOUND,
        status: 404,
      });
      expect(mockPrisma.clubs.findFirst).not.toHaveBeenCalled();
    });
  });
});
