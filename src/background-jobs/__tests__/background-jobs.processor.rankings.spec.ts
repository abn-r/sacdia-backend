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
  const mockRankingsService = {
    recalculateRankings: jest.fn(),
    recalculateAll: jest.fn(),
  };
  const mockDataExportService = { runExport: jest.fn() };
  const mockProgressSnapshot = { refreshYear: jest.fn() };
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
    mockProgressSnapshot.refreshYear.mockResolvedValue({
      yearId: 2026,
      upserted: 0,
      deleted: 0,
      failed: 0,
    });

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
      { runMonthEndReminders: jest.fn() } as never,
      module.get(RankingsService),
      module.get(DataExportService),
      module.get(CronRunLogger),
      mockProgressSnapshot as never,
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

    it('forwards yearId to recalculateRankings()', async () => {
      mockCronLogger.track.mockImplementation(
        async (_name: string, fn: () => Promise<unknown>) => fn(),
      );
      mockRankingsService.recalculateRankings.mockResolvedValue({
        updated: 3,
      });

      await processor.process(
        makeJob({ triggeredAt: new Date().toISOString(), yearId: 2026 }),
      );

      expect(mockRankingsService.recalculateRankings).toHaveBeenCalledWith(
        2026,
      );
      expect(mockRankingsService.recalculateAll).not.toHaveBeenCalled();
    });

    it('delegates to recalculateAll() when includeMemberRankings is true', async () => {
      mockCronLogger.track.mockImplementation(
        async (_name: string, fn: () => Promise<unknown>) => fn(),
      );
      mockRankingsService.recalculateAll.mockResolvedValue(undefined);

      await processor.process(
        makeJob({
          triggeredAt: new Date().toISOString(),
          yearId: 2026,
          mode: 'delta',
          includeMemberRankings: true,
        }),
      );

      expect(mockRankingsService.recalculateAll).toHaveBeenCalledWith(
        2026,
        'delta',
      );
      expect(mockRankingsService.recalculateRankings).not.toHaveBeenCalled();
    });

    it('refreshes the progress snapshot after the club step and returns its counts', async () => {
      const order: string[] = [];
      mockCronLogger.track.mockImplementation(
        async (_name: string, fn: () => Promise<unknown>) => fn(),
      );
      mockRankingsService.recalculateRankings.mockImplementation(async () => {
        order.push('club');
        return { updated: 7 };
      });
      const snapshot = { yearId: 2026, upserted: 12, deleted: 1, failed: 0 };
      mockProgressSnapshot.refreshYear.mockImplementation(async () => {
        order.push('snapshot');
        return snapshot;
      });

      const result = await processor.process(
        makeJob({ triggeredAt: new Date().toISOString(), yearId: 2026 }),
      );

      expect(order).toEqual(['club', 'snapshot']);
      expect(mockProgressSnapshot.refreshYear).toHaveBeenCalledWith(2026);
      expect(result).toEqual({
        itemsProcessed: 7,
        progressSnapshot: snapshot,
      });
    });

    it('refreshes the progress snapshot after recalculateAll() too', async () => {
      const order: string[] = [];
      mockCronLogger.track.mockImplementation(
        async (_name: string, fn: () => Promise<unknown>) => fn(),
      );
      mockRankingsService.recalculateAll.mockImplementation(async () => {
        order.push('club');
      });
      mockProgressSnapshot.refreshYear.mockImplementation(async () => {
        order.push('snapshot');
        return { yearId: 2026, upserted: 3, deleted: 0, failed: 0 };
      });

      await processor.process(
        makeJob({
          triggeredAt: new Date().toISOString(),
          yearId: 2026,
          includeMemberRankings: true,
        }),
      );

      expect(order).toEqual(['club', 'snapshot']);
      expect(mockProgressSnapshot.refreshYear).toHaveBeenCalledWith(2026);
    });

    it('does not fail the club job when the snapshot step throws', async () => {
      mockCronLogger.track.mockImplementation(
        async (_name: string, fn: () => Promise<unknown>) => fn(),
      );
      mockRankingsService.recalculateRankings.mockResolvedValue({
        updated: 5,
      });
      mockProgressSnapshot.refreshYear.mockRejectedValue(
        new Error('snapshot boom'),
      );

      const result = await processor.process(
        makeJob({ triggeredAt: new Date().toISOString() }),
      );

      expect(result).toEqual({ itemsProcessed: 5, progressSnapshot: null });
    });

    it('does not refresh the snapshot when the club step fails', async () => {
      mockCronLogger.track.mockImplementation(
        async (_name: string, fn: () => Promise<unknown>) => fn(),
      );
      mockRankingsService.recalculateRankings.mockRejectedValue(
        new Error('Transaction deadlock'),
      );

      await expect(
        processor.process(makeJob({ triggeredAt: new Date().toISOString() })),
      ).rejects.toThrow('Transaction deadlock');
      expect(mockProgressSnapshot.refreshYear).not.toHaveBeenCalled();
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
