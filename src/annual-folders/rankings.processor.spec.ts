import { Test, TestingModule } from '@nestjs/testing';
import { Job } from 'bullmq';
import {
  RankingsProcessor,
  RankingsTriggerJobData,
} from './rankings.processor';
import { RankingsService } from './rankings.service';
import { CronRunLogger } from '../common/services/cron-run-logger.service';

describe('RankingsProcessor', () => {
  let processor: RankingsProcessor;

  const mockRankingsService = {
    recalculateRankings: jest.fn(),
  };

  const mockCronRunLogger = {
    track: jest.fn(),
    trackSkipped: jest.fn(),
  };

  function makeJob(
    data: RankingsTriggerJobData,
    overrides: Partial<{
      id: string;
      attemptsMade: number;
      opts: { attempts: number };
    }> = {},
  ): Job<RankingsTriggerJobData> {
    return {
      id: 'test-job-2',
      name: 'recalculate',
      data,
      attemptsMade: 0,
      opts: { attempts: 5 },
      ...overrides,
    } as unknown as Job<RankingsTriggerJobData>;
  }

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        { provide: RankingsService, useValue: mockRankingsService },
        { provide: CronRunLogger, useValue: mockCronRunLogger },
      ],
    }).compile();

    processor = new RankingsProcessor(
      module.get(RankingsService),
      module.get(CronRunLogger),
    );
  });

  it('should be defined', () => {
    expect(processor).toBeDefined();
  });

  describe('process()', () => {
    it('delegates to cronLogger.track() which calls recalculateRankings()', async () => {
      mockCronRunLogger.track.mockImplementation(async (_name, fn) => fn());
      mockRankingsService.recalculateRankings.mockResolvedValue({
        updated: 42,
      });

      const job = makeJob({ triggeredAt: new Date().toISOString() });
      await processor.process(job);

      expect(mockCronRunLogger.track).toHaveBeenCalledWith(
        'rankings-recalculate',
        expect.any(Function),
        expect.objectContaining({ bull_job_id: 'test-job-2' }),
      );
      expect(mockRankingsService.recalculateRankings).toHaveBeenCalledTimes(1);
    });

    it('propagates errors so BullMQ can retry', async () => {
      mockCronRunLogger.track.mockImplementation(async (_name, fn) => fn());
      mockRankingsService.recalculateRankings.mockRejectedValue(
        new Error('Transaction deadlock'),
      );

      const job = makeJob({ triggeredAt: new Date().toISOString() });
      await expect(processor.process(job)).rejects.toThrow(
        'Transaction deadlock',
      );
    });
  });

  describe('onFailed()', () => {
    it('records skipped entry when max attempts exhausted', () => {
      mockCronRunLogger.trackSkipped.mockResolvedValue(undefined);

      const job = makeJob(
        { triggeredAt: new Date().toISOString() },
        { attemptsMade: 5, opts: { attempts: 5 } },
      );

      expect(() =>
        processor.onFailed(job, new Error('Max attempts reached')),
      ).not.toThrow();

      expect(mockCronRunLogger.trackSkipped).toHaveBeenCalledWith(
        'rankings-recalculate',
        expect.stringContaining('exhausted 5 attempts'),
      );
    });

    it('does NOT call trackSkipped on intermediate failures', () => {
      mockCronRunLogger.trackSkipped.mockResolvedValue(undefined);

      const job = makeJob(
        { triggeredAt: new Date().toISOString() },
        { attemptsMade: 1, opts: { attempts: 5 } },
      );

      processor.onFailed(job, new Error('Transient error'));

      expect(mockCronRunLogger.trackSkipped).not.toHaveBeenCalled();
    });

    it('handles undefined job gracefully', () => {
      expect(() =>
        processor.onFailed(undefined, new Error('Unknown')),
      ).not.toThrow();
    });
  });
});
