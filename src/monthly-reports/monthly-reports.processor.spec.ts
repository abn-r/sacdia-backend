import { Test, TestingModule } from '@nestjs/testing';
import { Job } from 'bullmq';
import {
  MonthlyReportsProcessor,
  MonthlyReportsTriggerJobData,
} from './monthly-reports.processor';
import { MonthlyReportsService } from './monthly-reports.service';
import { CronRunLogger } from '../common/services/cron-run-logger.service';

describe('MonthlyReportsProcessor', () => {
  let processor: MonthlyReportsProcessor;

  const mockMonthlyReportsService = {
    runAutoGeneration: jest.fn(),
  };

  const mockCronRunLogger = {
    track: jest.fn(),
    trackSkipped: jest.fn(),
  };

  /**
   * Build a fake BullMQ Job without requiring Redis infrastructure.
   */
  function makeJob(
    data: MonthlyReportsTriggerJobData,
    overrides: Partial<{ id: string; attemptsMade: number; opts: { attempts: number } }> = {},
  ): Job<MonthlyReportsTriggerJobData> {
    return {
      id: 'test-job-1',
      name: 'auto-generate',
      data,
      attemptsMade: 0,
      opts: { attempts: 5 },
      ...overrides,
    } as unknown as Job<MonthlyReportsTriggerJobData>;
  }

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        {
          provide: MonthlyReportsService,
          useValue: mockMonthlyReportsService,
        },
        {
          provide: CronRunLogger,
          useValue: mockCronRunLogger,
        },
      ],
    })
      .overrideProvider(MonthlyReportsService)
      .useValue(mockMonthlyReportsService)
      .compile();

    // Instantiate the processor directly to skip BullMQ DI metadata checks
    processor = new MonthlyReportsProcessor(
      module.get(MonthlyReportsService),
      module.get(CronRunLogger),
    );
  });

  it('should be defined', () => {
    expect(processor).toBeDefined();
  });

  describe('process()', () => {
    it('delegates to cronLogger.track() which calls runAutoGeneration()', async () => {
      mockCronRunLogger.track.mockImplementation(async (_name, fn) => fn());
      mockMonthlyReportsService.runAutoGeneration.mockResolvedValue({
        itemsProcessed: 3,
      });

      const job = makeJob({ triggeredAt: new Date().toISOString() });
      await processor.process(job);

      expect(mockCronRunLogger.track).toHaveBeenCalledWith(
        'monthly-reports-auto-generate',
        expect.any(Function),
        expect.objectContaining({ bull_job_id: 'test-job-1' }),
      );
      expect(mockMonthlyReportsService.runAutoGeneration).toHaveBeenCalledTimes(1);
    });

    it('propagates errors thrown by runAutoGeneration() so BullMQ can retry', async () => {
      mockCronRunLogger.track.mockImplementation(async (_name, fn) => fn());
      mockMonthlyReportsService.runAutoGeneration.mockRejectedValue(
        new Error('DB connection lost'),
      );

      const job = makeJob({ triggeredAt: new Date().toISOString() });
      await expect(processor.process(job)).rejects.toThrow('DB connection lost');
    });
  });

  describe('onFailed()', () => {
    it('logs the error and records a skipped entry when max attempts exhausted', () => {
      mockCronRunLogger.trackSkipped.mockResolvedValue(undefined);

      const job = makeJob(
        { triggeredAt: new Date().toISOString() },
        { attemptsMade: 5, opts: { attempts: 5 } },
      );

      // onFailed is a synchronous event handler — it should not throw
      expect(() =>
        processor.onFailed(job, new Error('Final failure')),
      ).not.toThrow();

      expect(mockCronRunLogger.trackSkipped).toHaveBeenCalledWith(
        'monthly-reports-auto-generate',
        expect.stringContaining('exhausted 5 attempts'),
      );
    });

    it('does NOT call trackSkipped when attempts are not exhausted', () => {
      mockCronRunLogger.trackSkipped.mockResolvedValue(undefined);

      const job = makeJob(
        { triggeredAt: new Date().toISOString() },
        { attemptsMade: 2, opts: { attempts: 5 } },
      );

      processor.onFailed(job, new Error('Transient error'));

      expect(mockCronRunLogger.trackSkipped).not.toHaveBeenCalled();
    });

    it('handles undefined job gracefully', () => {
      expect(() =>
        processor.onFailed(undefined, new Error('Unknown error')),
      ).not.toThrow();
    });
  });
});
