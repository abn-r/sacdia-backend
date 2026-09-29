import { Test, TestingModule } from '@nestjs/testing';
import {
  FinancePeriodService,
  listUtcMonthsThroughPrevious,
  previousUtcMonth,
  utcMonthClosedAt,
} from './finance-period.service';
import { PrismaService } from '../prisma/prisma.service';
import { ForbiddenException } from '@nestjs/common';
import { AuthorizationContextService } from '../common/services/authorization-context.service';
import { CronRunLogger } from '../common/services/cron-run-logger.service';
import { ErrorCode } from '../common/errors/error-codes';

describe('previousUtcMonth', () => {
  it('closes August when cron fires at 1 Sep 00:00 UTC', () => {
    const getMonth = jest.spyOn(Date.prototype, 'getMonth');
    const getFullYear = jest.spyOn(Date.prototype, 'getFullYear');

    expect(previousUtcMonth(new Date('2026-09-01T00:00:00.000Z'))).toEqual({
      year: 2026,
      month: 8,
    });

    expect(getMonth).not.toHaveBeenCalled();
    expect(getFullYear).not.toHaveBeenCalled();
    getMonth.mockRestore();
    getFullYear.mockRestore();
  });

  it('wraps January UTC to December of the previous year', () => {
    expect(previousUtcMonth(new Date('2026-01-01T00:00:00.000Z'))).toEqual({
      year: 2025,
      month: 12,
    });
  });
});

describe('utcMonthClosedAt', () => {
  it('stamps closing at 00:00 UTC on the first of the next month', () => {
    expect(utcMonthClosedAt(2026, 4).toISOString()).toBe(
      '2026-05-01T00:00:00.000Z',
    );
  });

  it('rolls December into January of the next year', () => {
    expect(utcMonthClosedAt(2026, 12).toISOString()).toBe(
      '2027-01-01T00:00:00.000Z',
    );
  });
});

describe('listUtcMonthsThroughPrevious', () => {
  it('includes January through August when now is mid-September UTC', () => {
    expect(
      listUtcMonthsThroughPrevious(
        new Date('2026-01-01T00:00:00.000Z'),
        new Date('2026-09-19T21:00:00.000Z'),
      ),
    ).toEqual([
      { year: 2026, month: 1 },
      { year: 2026, month: 2 },
      { year: 2026, month: 3 },
      { year: 2026, month: 4 },
      { year: 2026, month: 5 },
      { year: 2026, month: 6 },
      { year: 2026, month: 7 },
      { year: 2026, month: 8 },
    ]);
  });
});

describe('FinancePeriodService', () => {
  let service: FinancePeriodService;

  const mockPrismaService = {
    clubs: { findMany: jest.fn() },
    club_sections: { findMany: jest.fn() },
    finances: { findMany: jest.fn(), groupBy: jest.fn() },
    financePeriodClosing: {
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    ecclesiastical_years: { findFirst: jest.fn() },
  };

  const mockAuthorizationContextService = {
    hasAnyGlobalRole: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        FinancePeriodService,
        { provide: PrismaService, useValue: mockPrismaService },
        {
          provide: AuthorizationContextService,
          useValue: mockAuthorizationContextService,
        },
        {
          provide: CronRunLogger,
          useValue: {
            track: jest.fn(async (_name: string, fn: () => Promise<any>) =>
              fn(),
            ),
            trackSkipped: jest.fn().mockResolvedValue(undefined),
          },
        },
      ],
    }).compile();

    service = module.get<FinancePeriodService>(FinancePeriodService);
    jest.clearAllMocks();
  });

  describe('closeMonthForClub', () => {
    it('should aggregate movements and create a closing record', async () => {
      const clubId = 1,
        year = 2026,
        month = 2;

      mockPrismaService.club_sections.findMany.mockResolvedValue([
        { club_section_id: 10, club_types: { name: 'Conquistadores' } },
        { club_section_id: 11, club_types: { name: 'Aventureros' } },
      ]);

      mockPrismaService.finances.findMany.mockResolvedValue([
        {
          finance_id: 1,
          amount: 5000,
          club_section_id: 10,
          finance_category_id: 1,
          finances_categories: {
            finance_category_id: 1,
            name: 'Cuotas',
            type: 0,
          },
        },
        {
          finance_id: 2,
          amount: 2000,
          club_section_id: 10,
          finance_category_id: 3,
          finances_categories: {
            finance_category_id: 3,
            name: 'Materiales',
            type: 1,
          },
        },
        {
          finance_id: 3,
          amount: 3000,
          club_section_id: 11,
          finance_category_id: 1,
          finances_categories: {
            finance_category_id: 1,
            name: 'Cuotas',
            type: 0,
          },
        },
      ]);

      mockPrismaService.financePeriodClosing.findUnique.mockResolvedValue(null);
      const mockClosing = {
        finance_period_closing_id: 1,
        club_id: clubId,
        year,
        month,
      };
      mockPrismaService.financePeriodClosing.create.mockResolvedValue(
        mockClosing,
      );

      const result = await service.closeMonthForClub(clubId, year, month);

      expect(
        mockPrismaService.financePeriodClosing.create,
      ).toHaveBeenCalledWith({
        data: expect.objectContaining({
          club_id: clubId,
          year,
          month,
          total_income: 8000,
          total_expense: 2000,
          balance: 6000,
          movement_count: 3,
          breakdown: expect.objectContaining({
            by_category: expect.any(Array),
            by_section: expect.any(Array),
          }),
          closed_at: expect.any(Date),
          closed_by: null,
        }),
      });
      expect(result).toEqual(mockClosing);
    });

    it('should create a closing record with zero totals when no movements exist', async () => {
      mockPrismaService.club_sections.findMany.mockResolvedValue([
        { club_section_id: 10, club_types: { name: 'Conquistadores' } },
      ]);
      mockPrismaService.finances.findMany.mockResolvedValue([]);
      mockPrismaService.financePeriodClosing.findUnique.mockResolvedValue(null);
      const mockClosing = { finance_period_closing_id: 2, club_id: 1 };
      mockPrismaService.financePeriodClosing.create.mockResolvedValue(
        mockClosing,
      );

      await service.closeMonthForClub(1, 2026, 3);

      expect(
        mockPrismaService.financePeriodClosing.create,
      ).toHaveBeenCalledWith({
        data: expect.objectContaining({
          total_income: 0,
          total_expense: 0,
          balance: 0,
          movement_count: 0,
        }),
      });
    });

    it('should replace an existing closing when replace is true', async () => {
      mockPrismaService.club_sections.findMany.mockResolvedValue([
        { club_section_id: 10, club_types: { name: 'Conquistadores' } },
      ]);
      mockPrismaService.finances.findMany.mockResolvedValue([
        {
          finance_id: 12,
          amount: 100,
          club_section_id: 10,
          finance_category_id: 1,
          finances_categories: {
            finance_category_id: 1,
            name: 'Ventas',
            type: 0,
          },
        },
      ]);
      mockPrismaService.financePeriodClosing.findUnique.mockResolvedValue({
        finance_period_closing_id: 99,
        club_id: 1,
        year: 2026,
        month: 8,
      });
      const closedAt = utcMonthClosedAt(2026, 8);
      mockPrismaService.financePeriodClosing.update.mockResolvedValue({
        finance_period_closing_id: 99,
      });

      const result = await service.closeMonthForClub(1, 2026, 8, null, {
        replace: true,
        closedAt,
      });

      expect(result).toEqual({ finance_period_closing_id: 99 });
      expect(
        mockPrismaService.financePeriodClosing.create,
      ).not.toHaveBeenCalled();
      expect(
        mockPrismaService.financePeriodClosing.update,
      ).toHaveBeenCalledWith({
        where: { finance_period_closing_id: 99 },
        data: expect.objectContaining({
          total_income: 100,
          total_expense: 0,
          movement_count: 1,
          closed_at: closedAt,
          closed_by: null,
        }),
      });
    });

    it('should skip if a closing already exists for the period', async () => {
      mockPrismaService.club_sections.findMany.mockResolvedValue([
        { club_section_id: 10, club_types: { name: 'Conquistadores' } },
      ]);
      mockPrismaService.financePeriodClosing.findUnique.mockResolvedValue({
        finance_period_closing_id: 99,
        club_id: 1,
        year: 2026,
        month: 2,
      });

      const result = await service.closeMonthForClub(1, 2026, 2);
      expect(result).toBeNull();
      expect(
        mockPrismaService.financePeriodClosing.create,
      ).not.toHaveBeenCalled();
    });

    it('should build correct breakdown by category and section', async () => {
      mockPrismaService.club_sections.findMany.mockResolvedValue([
        { club_section_id: 10, club_types: { name: 'Conquistadores' } },
        { club_section_id: 11, club_types: { name: 'Aventureros' } },
      ]);

      mockPrismaService.finances.findMany.mockResolvedValue([
        {
          finance_id: 1,
          amount: 5000,
          club_section_id: 10,
          finance_category_id: 1,
          finances_categories: {
            finance_category_id: 1,
            name: 'Cuotas',
            type: 0,
          },
        },
        {
          finance_id: 2,
          amount: 2000,
          club_section_id: 11,
          finance_category_id: 1,
          finances_categories: {
            finance_category_id: 1,
            name: 'Cuotas',
            type: 0,
          },
        },
        {
          finance_id: 3,
          amount: 1500,
          club_section_id: 10,
          finance_category_id: 3,
          finances_categories: {
            finance_category_id: 3,
            name: 'Materiales',
            type: 1,
          },
        },
      ]);

      mockPrismaService.financePeriodClosing.findUnique.mockResolvedValue(null);
      mockPrismaService.financePeriodClosing.create.mockImplementation(
        ({ data }) =>
          Promise.resolve({ finance_period_closing_id: 1, ...data }),
      );

      await service.closeMonthForClub(1, 2026, 2);

      const createCall =
        mockPrismaService.financePeriodClosing.create.mock.calls[0][0];
      const breakdown = createCall.data.breakdown;

      expect(breakdown.by_category).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            finance_category_id: 1,
            name: 'Cuotas',
            type: 0,
            total: 7000,
          }),
          expect.objectContaining({
            finance_category_id: 3,
            name: 'Materiales',
            type: 1,
            total: 1500,
          }),
        ]),
      );

      expect(breakdown.by_section).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            club_section_id: 10,
            club_type_name: 'Conquistadores',
            income: 5000,
            expense: 1500,
            balance: 3500,
          }),
          expect.objectContaining({
            club_section_id: 11,
            club_type_name: 'Aventureros',
            income: 2000,
            expense: 0,
            balance: 2000,
          }),
        ]),
      );
    });
  });

  describe('validatePeriodOpen', () => {
    it('should allow when period is not closed', async () => {
      mockPrismaService.financePeriodClosing.findUnique.mockResolvedValue(null);

      await expect(
        service.validatePeriodOpen(1, 2026, 2, 'user-123'),
      ).resolves.not.toThrow();

      expect(
        mockAuthorizationContextService.hasAnyGlobalRole,
      ).not.toHaveBeenCalled();
    });

    it('should throw ForbiddenException when period is closed and user is not admin', async () => {
      mockPrismaService.financePeriodClosing.findUnique.mockResolvedValue({
        finance_period_closing_id: 1,
        club_id: 1,
        year: 2026,
        month: 2,
      });
      mockAuthorizationContextService.hasAnyGlobalRole.mockResolvedValue(false);

      await expect(
        service.validatePeriodOpen(1, 2026, 2, 'user-123'),
      ).rejects.toMatchObject({ code: ErrorCode.FINANCE_PERIOD_CLOSED });
    });

    it('should allow when period is closed and user is admin', async () => {
      mockPrismaService.financePeriodClosing.findUnique.mockResolvedValue({
        finance_period_closing_id: 1,
        club_id: 1,
        year: 2026,
        month: 2,
      });
      mockAuthorizationContextService.hasAnyGlobalRole.mockResolvedValue(true);

      await expect(
        service.validatePeriodOpen(1, 2026, 2, 'admin-user-456'),
      ).resolves.not.toThrow();

      expect(
        mockAuthorizationContextService.hasAnyGlobalRole,
      ).toHaveBeenCalledWith('admin-user-456', ['admin', 'super-admin']);
    });
  });

  describe('handleMonthlyClosing', () => {
    beforeEach(() => {
      jest.useFakeTimers();
      jest.setSystemTime(new Date('2026-04-01T12:00:00'));
      jest.spyOn(service, 'closeMonthForClub').mockResolvedValue(null);
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    it('should process all active clubs for the previous month', async () => {
      mockPrismaService.clubs.findMany
        .mockResolvedValueOnce([
          { club_id: 1, name: 'Club Alpha' },
          { club_id: 2, name: 'Club Beta' },
        ])
        .mockResolvedValueOnce([]);

      jest
        .spyOn(service, 'closeMonthForClub')
        .mockResolvedValueOnce({ finance_period_closing_id: 1 } as any)
        .mockResolvedValueOnce({ finance_period_closing_id: 2 } as any);

      await service.handleMonthlyClosing();

      expect(service.closeMonthForClub).toHaveBeenCalledWith(1, 2026, 3);
      expect(service.closeMonthForClub).toHaveBeenCalledWith(2, 2026, 3);
    });

    it('closes the previous UTC month at 00:00 UTC on the 1st', async () => {
      jest.setSystemTime(new Date('2026-09-01T00:00:00.000Z'));
      mockPrismaService.clubs.findMany
        .mockResolvedValueOnce([{ club_id: 1, name: 'ACV' }])
        .mockResolvedValueOnce([]);

      await service.handleMonthlyClosing();

      expect(service.closeMonthForClub).toHaveBeenCalledWith(1, 2026, 8);
    });

    it('should isolate errors per club and continue processing', async () => {
      mockPrismaService.clubs.findMany
        .mockResolvedValueOnce([
          { club_id: 1, name: 'Club Alpha' },
          { club_id: 2, name: 'Club Beta' },
          { club_id: 3, name: 'Club Gamma' },
        ])
        .mockResolvedValueOnce([]);

      jest
        .spyOn(service, 'closeMonthForClub')
        .mockResolvedValueOnce({ finance_period_closing_id: 1 } as any)
        .mockRejectedValueOnce(new Error('DB connection lost'))
        .mockResolvedValueOnce({ finance_period_closing_id: 3 } as any);

      await expect(service.handleMonthlyClosing()).resolves.not.toThrow();
      expect(service.closeMonthForClub).toHaveBeenCalledTimes(3);
    });
  });

  describe('rebuildCompletedClosings', () => {
    it('rebuilds each completed UTC month with the intended closing timestamp', async () => {
      mockPrismaService.ecclesiastical_years.findFirst.mockResolvedValue({
        start_date: new Date('2026-01-01T00:00:00.000Z'),
      });
      mockPrismaService.clubs.findMany.mockImplementation(
        async ({ skip }: { skip: number }) => {
          if (skip === 0) return [{ club_id: 1, name: 'ACV' }];
          return [];
        },
      );
      jest.spyOn(service, 'closeMonthForClub').mockResolvedValue({
        finance_period_closing_id: 1,
      } as Awaited<ReturnType<FinancePeriodService['closeMonthForClub']>>);

      const result = await service.rebuildCompletedClosings(
        new Date('2026-09-19T21:00:00.000Z'),
      );

      expect(result).toEqual({
        months: 8,
        itemsProcessed: 8,
        rebuilt: 8,
      });
      expect(service.closeMonthForClub).toHaveBeenCalledTimes(8);
      expect(service.closeMonthForClub).toHaveBeenCalledWith(1, 2026, 8, null, {
        replace: true,
        closedAt: utcMonthClosedAt(2026, 8),
      });
    });
  });
});
