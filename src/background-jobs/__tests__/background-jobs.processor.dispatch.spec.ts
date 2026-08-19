import { Test, TestingModule } from '@nestjs/testing';
import { Job } from 'bullmq';
import { BackgroundJobsProcessor } from '../background-jobs.processor';
import { BackgroundJobName } from '../background-jobs.types';
import { MonthlyReportsService } from '../../monthly-reports/monthly-reports.service';
import { FinancePeriodService } from '../../finances/finance-period.service';
import { RankingsService } from '../../annual-folders/rankings.service';
import { DataExportService } from '../../data-export/data-export.service';
import { CronRunLogger } from '../../common/services/cron-run-logger.service';

describe('BackgroundJobsProcessor — dispatch', () => {
  let processor: BackgroundJobsProcessor;

  const mockMonthlyReportsService = {
    runAutoGeneration: jest.fn(),
    generate: jest.fn(),
    regenerate: jest.fn(),
  };
  const mockFinancePeriodService = { runMonthlyClosing: jest.fn() };
  const mockRankingsService = {
    recalculateRankings: jest.fn(),
    recalculateAll: jest.fn(),
  };
  const mockDataExportService = { runExport: jest.fn() };
  const mockCronLogger = {
    track: jest.fn(),
    trackSkipped: jest.fn(),
  };

  function makeJob(name: string, data: unknown): Job<unknown> {
    return {
      id: 'dispatch-test-job',
      name,
      data,
      attemptsMade: 0,
      opts: { attempts: 5 },
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

  // ---------------------------------------------------------------------------
  // Parametrized dispatch table: each job name calls only its service
  // ---------------------------------------------------------------------------

  describe('parametrized dispatch table', () => {
    const cases = [
      {
        name: BackgroundJobName.MONTHLY_REPORTS_AUTO_GENERATE,
        data: { triggeredAt: new Date().toISOString() },
        expectService: 'monthly-reports',
        setup: () => {
          mockCronLogger.track.mockImplementation(
            async (_key: string, fn: () => Promise<unknown>) => fn(),
          );
          mockMonthlyReportsService.runAutoGeneration.mockResolvedValue({
            itemsProcessed: 1,
          });
        },
        verify: () => {
          expect(
            mockMonthlyReportsService.runAutoGeneration,
          ).toHaveBeenCalledTimes(1);
          expect(
            mockFinancePeriodService.runMonthlyClosing,
          ).not.toHaveBeenCalled();
          expect(
            mockRankingsService.recalculateRankings,
          ).not.toHaveBeenCalled();
          expect(mockDataExportService.runExport).not.toHaveBeenCalled();
        },
      },
      {
        name: BackgroundJobName.MONTHLY_REPORT_PDF,
        data: {
          reportId: 'report-1',
          action: 'generate',
          triggeredAt: new Date().toISOString(),
        },
        expectService: 'monthly-reports-pdf',
        setup: () => {
          mockMonthlyReportsService.generate.mockResolvedValue({
            monthly_report_id: 'report-1',
          });
        },
        verify: () => {
          expect(mockMonthlyReportsService.generate).toHaveBeenCalledWith(
            'report-1',
            'system',
          );
          expect(
            mockMonthlyReportsService.runAutoGeneration,
          ).not.toHaveBeenCalled();
          expect(mockMonthlyReportsService.regenerate).not.toHaveBeenCalled();
          expect(
            mockFinancePeriodService.runMonthlyClosing,
          ).not.toHaveBeenCalled();
          expect(
            mockRankingsService.recalculateRankings,
          ).not.toHaveBeenCalled();
          expect(mockDataExportService.runExport).not.toHaveBeenCalled();
        },
      },
      {
        name: BackgroundJobName.FINANCE_PERIOD_CLOSE_MONTH,
        data: { triggeredAt: new Date().toISOString(), year: 2026, month: 4 },
        expectService: 'finance-period',
        setup: () => {
          mockFinancePeriodService.runMonthlyClosing.mockResolvedValue({
            itemsProcessed: 8,
          });
        },
        verify: () => {
          expect(
            mockFinancePeriodService.runMonthlyClosing,
          ).toHaveBeenCalledWith(2026, 4);
          expect(
            mockMonthlyReportsService.runAutoGeneration,
          ).not.toHaveBeenCalled();
          expect(
            mockRankingsService.recalculateRankings,
          ).not.toHaveBeenCalled();
          expect(mockDataExportService.runExport).not.toHaveBeenCalled();
        },
      },
      {
        name: BackgroundJobName.RANKINGS_RECALCULATE,
        data: { triggeredAt: new Date().toISOString() },
        expectService: 'rankings',
        setup: () => {
          mockCronLogger.track.mockImplementation(
            async (_key: string, fn: () => Promise<unknown>) => fn(),
          );
          mockRankingsService.recalculateRankings.mockResolvedValue({
            updated: 10,
          });
        },
        verify: () => {
          expect(mockRankingsService.recalculateRankings).toHaveBeenCalledTimes(
            1,
          );
          expect(
            mockMonthlyReportsService.runAutoGeneration,
          ).not.toHaveBeenCalled();
          expect(
            mockFinancePeriodService.runMonthlyClosing,
          ).not.toHaveBeenCalled();
          expect(mockDataExportService.runExport).not.toHaveBeenCalled();
        },
      },
      {
        name: BackgroundJobName.DATA_EXPORT_GENERATE,
        data: { exportId: 'exp-1', userId: 'user-1' },
        expectService: 'data-export',
        setup: () => {
          mockDataExportService.runExport.mockResolvedValue({
            exportId: 'exp-1',
          });
        },
        verify: () => {
          expect(mockDataExportService.runExport).toHaveBeenCalledWith(
            'exp-1',
            'user-1',
          );
          expect(
            mockMonthlyReportsService.runAutoGeneration,
          ).not.toHaveBeenCalled();
          expect(
            mockFinancePeriodService.runMonthlyClosing,
          ).not.toHaveBeenCalled();
          expect(
            mockRankingsService.recalculateRankings,
          ).not.toHaveBeenCalled();
        },
      },
    ];

    it.each(cases)(
      'job "$name" dispatches only to $expectService service',
      async ({ name, data, setup, verify }) => {
        setup();
        await processor.process(makeJob(name, data));
        verify();
      },
    );
  });

  // ---------------------------------------------------------------------------
  // Unknown job name → throws (exhaustiveness check)
  // ---------------------------------------------------------------------------

  it('throws on unknown job name', async () => {
    await expect(
      processor.process(makeJob('unknown-job-name', {})),
    ).rejects.toThrow('Unknown background job name: unknown-job-name');
  });

  // ---------------------------------------------------------------------------
  // onFailed with unknown job.name — must not throw (defensive)
  // ---------------------------------------------------------------------------

  it('onFailed with unknown job name does not throw and does not call trackSkipped', () => {
    mockCronLogger.trackSkipped.mockResolvedValue(undefined);

    const unknownJob = {
      id: 'unknown-job',
      name: 'not-a-real-job',
      data: {},
      attemptsMade: 5,
      opts: { attempts: 5 },
      failedReason: 'some error',
    } as unknown as Job<unknown>;

    expect(() =>
      processor.onFailed(unknownJob, new Error('Failure')),
    ).not.toThrow();
    expect(mockCronLogger.trackSkipped).not.toHaveBeenCalled();
  });

  // ---------------------------------------------------------------------------
  // onFailed: data-export at max attempts → NO trackSkipped (no cron key)
  // onFailed: cron jobs at max attempts → trackSkipped called
  // ---------------------------------------------------------------------------

  it('onFailed for cron jobs at max attempts calls trackSkipped', () => {
    mockCronLogger.trackSkipped.mockResolvedValue(undefined);

    const cronJobs = [
      BackgroundJobName.MONTHLY_REPORTS_AUTO_GENERATE,
      BackgroundJobName.FINANCE_PERIOD_CLOSE_MONTH,
      BackgroundJobName.RANKINGS_RECALCULATE,
    ] as const;

    for (const jobName of cronJobs) {
      jest.clearAllMocks();
      mockCronLogger.trackSkipped.mockResolvedValue(undefined);

      const job = makeJob(jobName, { triggeredAt: '2026-01-01T00:00:00Z' });
      (job as any).attemptsMade = 5;
      (job as any).opts = { attempts: 5 };

      processor.onFailed(job, new Error('Max reached'));
      expect(mockCronLogger.trackSkipped).toHaveBeenCalledTimes(1);
    }
  });

  it('onFailed for data-export at max attempts does NOT call trackSkipped', () => {
    mockCronLogger.trackSkipped.mockResolvedValue(undefined);

    const job = makeJob(BackgroundJobName.DATA_EXPORT_GENERATE, {
      exportId: 'exp-x',
      userId: 'user-x',
    });
    (job as any).attemptsMade = 1;
    (job as any).opts = { attempts: 1 };

    processor.onFailed(job, new Error('Export failed'));
    expect(mockCronLogger.trackSkipped).not.toHaveBeenCalled();
  });

  it('onFailed for monthly PDF at max attempts does NOT call trackSkipped', () => {
    mockCronLogger.trackSkipped.mockResolvedValue(undefined);

    const job = makeJob(BackgroundJobName.MONTHLY_REPORT_PDF, {
      reportId: 'report-x',
      action: 'generate',
      triggeredAt: '2026-01-01T00:00:00Z',
    });
    (job as any).attemptsMade = 3;
    (job as any).opts = { attempts: 3 };

    processor.onFailed(job, new Error('R2 unavailable'));
    expect(mockCronLogger.trackSkipped).not.toHaveBeenCalled();
  });
});
