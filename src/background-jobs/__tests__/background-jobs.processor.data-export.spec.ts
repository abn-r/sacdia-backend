import { Test, TestingModule } from '@nestjs/testing';
import { Job } from 'bullmq';
import { BackgroundJobsProcessor } from '../background-jobs.processor';
import { BackgroundJobName, DataExportGeneratePayload } from '../background-jobs.types';
import { MonthlyReportsService } from '../../monthly-reports/monthly-reports.service';
import { FinancePeriodService } from '../../finances/finance-period.service';
import { RankingsService } from '../../annual-folders/rankings.service';
import { DataExportService } from '../../data-export/data-export.service';
import { CronRunLogger } from '../../common/services/cron-run-logger.service';

describe('BackgroundJobsProcessor — data-export', () => {
  let processor: BackgroundJobsProcessor;

  const mockMonthlyReportsService = { runAutoGeneration: jest.fn() };
  const mockFinancePeriodService = { runMonthlyClosing: jest.fn() };
  const mockRankingsService = { recalculateRankings: jest.fn() };
  const mockDataExportService = { runExport: jest.fn() };
  const mockCronLogger = {
    track: jest.fn(),
    trackSkipped: jest.fn(),
  };

  const basePayload: DataExportGeneratePayload = {
    exportId: 'export-uuid-001',
    userId: 'user-uuid-001',
  };

  function makeJob(
    data: DataExportGeneratePayload,
    overrides: Partial<{ id: string; attemptsMade: number; opts: { attempts: number } }> = {},
  ): Job<unknown> {
    return {
      id: 'test-job-de',
      name: BackgroundJobName.DATA_EXPORT_GENERATE,
      data,
      attemptsMade: 0,
      opts: { attempts: 1 },
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

  describe('process() — DATA_EXPORT_GENERATE', () => {
    it('delegates to DataExportService.runExport()', async () => {
      mockDataExportService.runExport.mockResolvedValue({
        exportId: basePayload.exportId,
        fileSizeBytes: 1234,
      });

      const job = makeJob(basePayload);
      const result = await processor.process(job);

      expect(mockDataExportService.runExport).toHaveBeenCalledWith(
        basePayload.exportId,
        basePayload.userId,
      );
      expect(result).toMatchObject({ exportId: basePayload.exportId });
    });

    it('propagates rejection from DataExportService.runExport()', async () => {
      mockDataExportService.runExport.mockRejectedValue(new Error('R2 failure'));

      const job = makeJob(basePayload);
      await expect(processor.process(job)).rejects.toThrow('R2 failure');
    });
  });

  describe('onFailed() — data-export (no cron key)', () => {
    it('does NOT call trackSkipped even at max attempts (data-export has no cron key)', () => {
      mockCronLogger.trackSkipped.mockResolvedValue(undefined);

      const job = makeJob(basePayload, { attemptsMade: 1, opts: { attempts: 1 } });
      processor.onFailed(job, new Error('Export failed'));

      // data-export is not in MAP_JOB_TO_CRON_KEY — trackSkipped must NOT be called
      expect(mockCronLogger.trackSkipped).not.toHaveBeenCalled();
    });
  });
});
