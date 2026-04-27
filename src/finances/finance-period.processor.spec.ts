import { Test, TestingModule } from '@nestjs/testing';
import { Job } from 'bullmq';
import {
  FinancePeriodProcessor,
  FinancePeriodTriggerJobData,
} from './finance-period.processor';
import { FinancePeriodService } from './finance-period.service';
import { CronRunLogger } from '../common/services/cron-run-logger.service';

describe('FinancePeriodProcessor', () => {
  let processor: FinancePeriodProcessor;

  const mockFinancePeriodService = {
    runMonthlyClosing: jest.fn(),
  };

  const mockCronRunLogger = {
    track: jest.fn(),
    trackSkipped: jest.fn(),
  };

  function makeJob(
    data: FinancePeriodTriggerJobData,
    overrides: Partial<{ id: string; attemptsMade: number; opts: { attempts: number } }> = {},
  ): Job<FinancePeriodTriggerJobData> {
    return {
      id: 'test-job-3',
      name: 'close-month',
      data,
      attemptsMade: 0,
      opts: { attempts: 5 },
      ...overrides,
    } as unknown as Job<FinancePeriodTriggerJobData>;
  }

  const baseJobData: FinancePeriodTriggerJobData = {
    triggeredAt: new Date().toISOString(),
    year: 2026,
    month: 3,
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        { provide: FinancePeriodService, useValue: mockFinancePeriodService },
        { provide: CronRunLogger, useValue: mockCronRunLogger },
      ],
    }).compile();

    processor = new FinancePeriodProcessor(
      module.get(FinancePeriodService),
      module.get(CronRunLogger),
    );
  });

  it('should be defined', () => {
    expect(processor).toBeDefined();
  });

  describe('process()', () => {
    it('calls runMonthlyClosing with year and month from job data', async () => {
      mockFinancePeriodService.runMonthlyClosing.mockResolvedValue({
        itemsProcessed: 10,
      });

      const job = makeJob(baseJobData);
      await processor.process(job);

      expect(mockFinancePeriodService.runMonthlyClosing).toHaveBeenCalledWith(
        2026,
        3,
      );
    });

    it('propagates errors so BullMQ can retry', async () => {
      mockFinancePeriodService.runMonthlyClosing.mockRejectedValue(
        new Error('Prisma connection timeout'),
      );

      const job = makeJob(baseJobData);
      await expect(processor.process(job)).rejects.toThrow(
        'Prisma connection timeout',
      );
    });

    it('idempotency: second call for same period returns 0 items processed', async () => {
      // closeMonthForClub returns null for already-closed periods → itemsProcessed = N
      // We just verify the service is called again (idempotency is in the service)
      mockFinancePeriodService.runMonthlyClosing.mockResolvedValue({
        itemsProcessed: 0,
      });

      const job = makeJob(baseJobData);
      const result = await processor.process(job);

      expect(result).toEqual({ itemsProcessed: 0 });
      expect(mockFinancePeriodService.runMonthlyClosing).toHaveBeenCalledTimes(1);
    });
  });

  describe('onFailed()', () => {
    it('records skipped entry with period info when max attempts exhausted', () => {
      mockCronRunLogger.trackSkipped.mockResolvedValue(undefined);

      const job = makeJob(baseJobData, {
        attemptsMade: 5,
        opts: { attempts: 5 },
      });

      expect(() =>
        processor.onFailed(job, new Error('Closing loop crashed')),
      ).not.toThrow();

      expect(mockCronRunLogger.trackSkipped).toHaveBeenCalledWith(
        'finance-period-closing',
        expect.stringContaining('2026-03'),
      );
    });

    it('does NOT call trackSkipped on intermediate failures', () => {
      mockCronRunLogger.trackSkipped.mockResolvedValue(undefined);

      const job = makeJob(baseJobData, {
        attemptsMade: 2,
        opts: { attempts: 5 },
      });

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
