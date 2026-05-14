import { Test, TestingModule } from '@nestjs/testing';
import { Job } from 'bullmq';
import { BackgroundJobsProcessor } from '../background-jobs.processor';
import {
  BackgroundJobName,
  RankingsRecalculatePayload,
} from '../background-jobs.types';
import { MonthlyReportsService } from '../../monthly-reports/monthly-reports.service';
import { FinancePeriodService } from '../../finances/finance-period.service';
import { RankingsService } from '../../annual-folders/rankings.service';
import { DataExportService } from '../../data-export/data-export.service';
import { CronRunLogger } from '../../common/services/cron-run-logger.service';

describe('BackgroundJobsProcessor — rankings', () => {
  let processor: BackgroundJobsProcessor;

  const mockMonthlyReportsService = { runAutoGeneration: jest.fn() };
  const mockFinancePeriodService = { runMonthlyClosing: jest.fn() };
  const mockRankingsService = { recalculateRankings: jest.fn() };
  const mockDataExportService = { runExport: jest.fn() };
  const mockCronLogger = {
    track: jest.fn(),
    trackSkipped: jest.fn(),
  };

  function makeJob(
    data: RankingsRecalculatePayload,
    overrides: Partial<{
      id: string;
      attemptsMade: number;
      opts: { attempts: number };
    }> = {},
  ): Job<unknown> {
    return {
      id: 'test-job-rk',
      name: BackgroundJobName.RANKINGS_RECALCULATE,
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

  describe('process() — RANKINGS_RECALCULATE', () => {
    it('delegates to cronLogger.track() which calls recalculateRankings()', async () => {
      mockCronLogger.track.mockImplementation(
        async (_name: string, fn: () => Promise<unknown>) => fn(),
      );
      mockRankingsService.recalculateRankings.mockResolvedValue({
        updated: 42,
      });

      const job = makeJob({ triggeredAt: new Date().toISOString() });
      await processor.process(job);

      expect(mockCronLogger.track).toHaveBeenCalledWith(
        'rankings-recalculate',
        expect.any(Function),
        expect.objectContaining({ bull_job_id: 'test-job-rk' }),
      );
      expect(mockRankingsService.recalculateRankings).toHaveBeenCalledTimes(1);
    });

    it('propagates errors so BullMQ can retry', async () => {
      mockCronLogger.track.mockImplementation(
        async (_name: string, fn: () => Promise<unknown>) => fn(),
      );
      mockRankingsService.recalculateRankings.mockRejectedValue(
        new Error('Transaction deadlock'),
      );

      const job = makeJob({ triggeredAt: new Date().toISOString() });
      await expect(processor.process(job)).rejects.toThrow(
        'Transaction deadlock',
      );
    });
  });

  describe('onFailed() — rankings', () => {
    it('records skipped entry when max attempts exhausted', () => {
      mockCronLogger.trackSkipped.mockResolvedValue(undefined);

      const job = makeJob(
        { triggeredAt: new Date().toISOString() },
        { attemptsMade: 5, opts: { attempts: 5 } },
      );

      expect(() =>
        processor.onFailed(job, new Error('Max attempts reached')),
      ).not.toThrow();
      expect(mockCronLogger.trackSkipped).toHaveBeenCalledWith(
        'rankings-recalculate',
        expect.stringContaining('exhausted 5 attempts'),
      );
    });

    it('does NOT call trackSkipped on intermediate failures', () => {
      mockCronLogger.trackSkipped.mockResolvedValue(undefined);

      const job = makeJob(
        { triggeredAt: new Date().toISOString() },
        { attemptsMade: 1, opts: { attempts: 5 } },
      );
      processor.onFailed(job, new Error('Transient error'));

      expect(mockCronLogger.trackSkipped).not.toHaveBeenCalled();
    });

    it('handles undefined job gracefully', () => {
      expect(() =>
        processor.onFailed(undefined, new Error('Unknown')),
      ).not.toThrow();
    });
  });
});
