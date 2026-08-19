import { Test, TestingModule } from '@nestjs/testing';
import { Job } from 'bullmq';
import { BackgroundJobsProcessor } from '../background-jobs.processor';
import {
  BackgroundJobName,
  MonthlyReportsAutoGeneratePayload,
  MonthlyReportPdfPayload,
} from '../background-jobs.types';
import { MonthlyReportsService } from '../../monthly-reports/monthly-reports.service';
import { FinancePeriodService } from '../../finances/finance-period.service';
import { RankingsService } from '../../annual-folders/rankings.service';
import { DataExportService } from '../../data-export/data-export.service';
import { CronRunLogger } from '../../common/services/cron-run-logger.service';
import { AppBadRequestException } from '../../common/errors/app.exception';
import { ErrorCode } from '../../common/errors/error-codes';

describe('BackgroundJobsProcessor — monthly-reports', () => {
  let processor: BackgroundJobsProcessor;

  const mockMonthlyReportsService = {
    runAutoGeneration: jest.fn(),
    generate: jest.fn(),
    regenerate: jest.fn(),
  };
  const mockFinancePeriodService = {
    runMonthlyClosing: jest.fn(),
  };
  const mockRankingsService = {
    recalculateRankings: jest.fn(),
  };
  const mockDataExportService = {
    runExport: jest.fn(),
  };
  const mockCronLogger = {
    track: jest.fn(),
    trackSkipped: jest.fn(),
  };

  function makeJob(
    name: BackgroundJobName,
    data: MonthlyReportsAutoGeneratePayload,
    overrides: Partial<{
      id: string;
      attemptsMade: number;
      opts: { attempts: number };
    }> = {},
  ): Job<unknown> {
    return {
      id: 'test-job-mr',
      name,
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

  it('should be defined', () => {
    expect(processor).toBeDefined();
  });

  describe('process() — MONTHLY_REPORTS_AUTO_GENERATE', () => {
    it('delegates to cronLogger.track() which calls runAutoGeneration()', async () => {
      mockCronLogger.track.mockImplementation(
        async (_name: string, fn: () => Promise<unknown>) => fn(),
      );
      mockMonthlyReportsService.runAutoGeneration.mockResolvedValue({
        itemsProcessed: 5,
      });

      const job = makeJob(BackgroundJobName.MONTHLY_REPORTS_AUTO_GENERATE, {
        triggeredAt: new Date().toISOString(),
      });
      await processor.process(job);

      expect(mockCronLogger.track).toHaveBeenCalledWith(
        'monthly-reports-auto-generate',
        expect.any(Function),
        expect.objectContaining({ bull_job_id: 'test-job-mr' }),
      );
      expect(mockMonthlyReportsService.runAutoGeneration).toHaveBeenCalledTimes(
        1,
      );
    });

    it('propagates errors so BullMQ can retry', async () => {
      mockCronLogger.track.mockImplementation(
        async (_name: string, fn: () => Promise<unknown>) => fn(),
      );
      mockMonthlyReportsService.runAutoGeneration.mockRejectedValue(
        new Error('DB connection lost'),
      );

      const job = makeJob(BackgroundJobName.MONTHLY_REPORTS_AUTO_GENERATE, {
        triggeredAt: new Date().toISOString(),
      });
      await expect(processor.process(job)).rejects.toThrow(
        'DB connection lost',
      );
    });
  });

  describe('onFailed() — monthly-reports', () => {
    it('calls trackSkipped when max attempts exhausted', () => {
      mockCronLogger.trackSkipped.mockResolvedValue(undefined);

      const job = makeJob(
        BackgroundJobName.MONTHLY_REPORTS_AUTO_GENERATE,
        { triggeredAt: new Date().toISOString() },
        { attemptsMade: 5, opts: { attempts: 5 } },
      );

      expect(() =>
        processor.onFailed(job, new Error('Final failure')),
      ).not.toThrow();
      expect(mockCronLogger.trackSkipped).toHaveBeenCalledWith(
        'monthly-reports-auto-generate',
        expect.stringContaining('exhausted 5 attempts'),
      );
    });

    it('does NOT call trackSkipped on intermediate failures', () => {
      mockCronLogger.trackSkipped.mockResolvedValue(undefined);

      const job = makeJob(
        BackgroundJobName.MONTHLY_REPORTS_AUTO_GENERATE,
        { triggeredAt: new Date().toISOString() },
        { attemptsMade: 2, opts: { attempts: 5 } },
      );

      processor.onFailed(job, new Error('Transient error'));
      expect(mockCronLogger.trackSkipped).not.toHaveBeenCalled();
    });

    it('handles undefined job gracefully', () => {
      expect(() =>
        processor.onFailed(undefined, new Error('Unknown error')),
      ).not.toThrow();
    });
  });

  describe('process() — MONTHLY_REPORT_PDF', () => {
    function makePdfJob(data: MonthlyReportPdfPayload): Job<unknown> {
      return {
        id: 'test-job-pdf',
        name: BackgroundJobName.MONTHLY_REPORT_PDF,
        data,
        attemptsMade: 0,
        opts: { attempts: 3 },
      } as unknown as Job<unknown>;
    }

    it('calls generate() for action generate', async () => {
      mockMonthlyReportsService.generate.mockResolvedValue({
        monthly_report_id: 'report-1',
      });

      await processor.process(
        makePdfJob({
          reportId: 'report-1',
          action: 'generate',
          requestedBy: 'user-1',
          triggeredAt: new Date().toISOString(),
        }),
      );

      expect(mockMonthlyReportsService.generate).toHaveBeenCalledWith(
        'report-1',
        'user-1',
      );
      expect(mockMonthlyReportsService.regenerate).not.toHaveBeenCalled();
    });

    it('calls regenerate() for action regenerate', async () => {
      mockMonthlyReportsService.regenerate.mockResolvedValue({
        monthly_report_id: 'report-1',
      });

      await processor.process(
        makePdfJob({
          reportId: 'report-1',
          action: 'regenerate',
          triggeredAt: new Date().toISOString(),
        }),
      );

      expect(mockMonthlyReportsService.regenerate).toHaveBeenCalledWith(
        'report-1',
      );
      expect(mockMonthlyReportsService.generate).not.toHaveBeenCalled();
    });

    it('skips already-generated reports instead of retrying', async () => {
      mockMonthlyReportsService.generate.mockRejectedValue(
        new AppBadRequestException(ErrorCode.MONTHLY_REPORT_NOT_DRAFT),
      );

      await expect(
        processor.process(
          makePdfJob({
            reportId: 'report-1',
            action: 'generate',
            triggeredAt: new Date().toISOString(),
          }),
        ),
      ).resolves.toEqual({
        skipped: true,
        reportId: 'report-1',
        action: 'generate',
      });
    });

    it('propagates storage failures so BullMQ can retry', async () => {
      mockMonthlyReportsService.generate.mockRejectedValue(
        new Error('R2 unavailable'),
      );

      await expect(
        processor.process(
          makePdfJob({
            reportId: 'report-1',
            action: 'generate',
            triggeredAt: new Date().toISOString(),
          }),
        ),
      ).rejects.toThrow('R2 unavailable');
    });
  });
});
