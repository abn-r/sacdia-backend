import { Test, TestingModule } from '@nestjs/testing';
import { Job } from 'bullmq';
import { BackgroundJobsProcessor } from '../background-jobs.processor';
import {
  BackgroundJobName,
  FinancePeriodCloseMonthPayload,
} from '../background-jobs.types';
import { MonthlyReportsService } from '../../monthly-reports/monthly-reports.service';
import { FinancePeriodService } from '../../finances/finance-period.service';
import { RankingsService } from '../../annual-folders/rankings.service';
import { DataExportService } from '../../data-export/data-export.service';
import { CronRunLogger } from '../../common/services/cron-run-logger.service';

describe('BackgroundJobsProcessor — finance-period', () => {
  let processor: BackgroundJobsProcessor;

  const mockMonthlyReportsService = { runAutoGeneration: jest.fn() };
  const mockFinancePeriodService = { runMonthlyClosing: jest.fn() };
  const mockRankingsService = { recalculateRankings: jest.fn() };
  const mockDataExportService = { runExport: jest.fn() };
  const mockCronLogger = {
    track: jest.fn(),
    trackSkipped: jest.fn(),
  };

  const basePayload: FinancePeriodCloseMonthPayload = {
    triggeredAt: new Date().toISOString(),
    year: 2026,
    month: 3,
  };

  function makeJob(
    data: FinancePeriodCloseMonthPayload,
    overrides: Partial<{
      id: string;
      attemptsMade: number;
      opts: { attempts: number };
    }> = {},
  ): Job<unknown> {
    return {
      id: 'test-job-fp',
      name: BackgroundJobName.FINANCE_PERIOD_CLOSE_MONTH,
      data,
      attemptsMade: 0,
      opts: { attempts: 5 },
      ...overrides,
    } as unknown as Job<unknown>;
  }

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        { provide: MonthlyReportsService, useValue: mockMonthlyReportsService },
        { provide: FinancePeriodService, useValue: mockFinancePeriodService },
        { provide: RankingsService, useValue: mockRankingsService },
        { provide: DataExportService, useValue: mockDataExportService },
        { provide: CronRunLogger, useValue: mockCronLogger },
      ],
    }).compile();

    processor = new BackgroundJobsProcessor(
      module.get(MonthlyReportsService),
      module.get(FinancePeriodService),
      module.get(RankingsService),
      module.get(DataExportService),
      module.get(CronRunLogger),
    );

    Object.defineProperty(processor, 'worker', {
      value: { on: jest.fn() },
      writable: true,
      configurable: true,
    });
  });

  describe('process() — FINANCE_PERIOD_CLOSE_MONTH', () => {
    it('calls runMonthlyClosing with year and month from job data', async () => {
      mockFinancePeriodService.runMonthlyClosing.mockResolvedValue({
        itemsProcessed: 12,
      });

      await processor.process(makeJob(basePayload));

      expect(mockFinancePeriodService.runMonthlyClosing).toHaveBeenCalledWith(
        2026,
        3,
      );
    });

    it('propagates errors so BullMQ can retry', async () => {
      mockFinancePeriodService.runMonthlyClosing.mockRejectedValue(
        new Error('Prisma timeout'),
      );

      await expect(processor.process(makeJob(basePayload))).rejects.toThrow(
        'Prisma timeout',
      );
    });

    it('idempotency: second call for same period returns 0 items processed', async () => {
      mockFinancePeriodService.runMonthlyClosing.mockResolvedValue({
        itemsProcessed: 0,
      });

      const result = await processor.process(makeJob(basePayload));
      expect(result).toEqual({ itemsProcessed: 0 });
    });
  });

  describe('onFailed() — finance-period', () => {
    it('records skipped entry with period info when max attempts exhausted', () => {
      mockCronLogger.trackSkipped.mockResolvedValue(undefined);

      const job = makeJob(basePayload, {
        attemptsMade: 5,
        opts: { attempts: 5 },
      });

      expect(() =>
        processor.onFailed(job, new Error('Closing loop crashed')),
      ).not.toThrow();
      expect(mockCronLogger.trackSkipped).toHaveBeenCalledWith(
        'finance-period-closing',
        expect.stringContaining('exhausted 5 attempts'),
      );
    });

    it('does NOT call trackSkipped on intermediate failures', () => {
      mockCronLogger.trackSkipped.mockResolvedValue(undefined);

      const job = makeJob(basePayload, {
        attemptsMade: 2,
        opts: { attempts: 5 },
      });
      processor.onFailed(job, new Error('Transient error'));

      expect(mockCronLogger.trackSkipped).not.toHaveBeenCalled();
    });
  });
});
