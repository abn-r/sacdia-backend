import { Prisma } from '@prisma/client';
import { CronRunLogger } from './cron-run-logger.service';
import {
  getManualCronContext,
  manualTriggerPayload,
  runWithManualCronContext,
  runWithManualTriggerFromPayload,
  type ManualCronContext,
} from './cron-run-context';
import type { PrismaService } from '../../prisma/prisma.service';

describe('CronRunLogger manual runs', () => {
  const prisma = {
    cron_run_log: {
      create: jest.fn(),
      update: jest.fn(),
    },
  };
  let logger: CronRunLogger;

  const manualContext = (): ManualCronContext => ({
    triggeredBy: 'admin-1',
    outcomes: [],
  });

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.cron_run_log.create.mockResolvedValue({ run_id: 41 });
    prisma.cron_run_log.update.mockResolvedValue({});
    logger = new CronRunLogger(prisma as unknown as PrismaService);
  });

  describe('track', () => {
    it('leaves the metadata of a scheduled run untouched', async () => {
      await logger.track('job-a', async () => ({ itemsProcessed: 3 }), {
        bull_job_id: '9',
      });

      expect(prisma.cron_run_log.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          job_name: 'job-a',
          metadata: { bull_job_id: '9' },
        }),
      });
      expect(getManualCronContext()).toBeUndefined();
    });

    it('stores JsonNull for a scheduled run without metadata', async () => {
      await logger.track('job-a', async () => undefined);

      expect(prisma.cron_run_log.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ metadata: Prisma.JsonNull }),
      });
    });

    it('marks a manual run and merges the existing metadata', async () => {
      await runWithManualCronContext(manualContext(), () =>
        logger.track('job-a', async () => ({ itemsProcessed: 3 }), {
          bull_job_id: '9',
        }),
      );

      expect(prisma.cron_run_log.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          metadata: {
            bull_job_id: '9',
            trigger: 'manual',
            triggered_by: 'admin-1',
          },
        }),
      });
    });

    it('marks a manual run that carries no metadata of its own', async () => {
      await runWithManualCronContext(manualContext(), () =>
        logger.track('job-a', async () => undefined),
      );

      expect(prisma.cron_run_log.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          metadata: { trigger: 'manual', triggered_by: 'admin-1' },
        }),
      });
    });

    it('records the completed outcome in the manual context', async () => {
      const ctx = manualContext();

      await runWithManualCronContext(ctx, () =>
        logger.track('job-a', async () => ({ itemsProcessed: 7 })),
      );

      expect(ctx.outcomes).toEqual([
        {
          runId: 41,
          status: 'completed',
          itemsProcessed: 7,
          errorMessage: null,
          durationMs: expect.any(Number),
        },
      ]);
    });

    it('records the failed outcome and still rethrows', async () => {
      const ctx = manualContext();

      await expect(
        runWithManualCronContext(ctx, () =>
          logger.track('job-a', async () => {
            throw new Error('boom');
          }),
        ),
      ).rejects.toThrow('boom');

      expect(ctx.outcomes).toEqual([
        {
          runId: 41,
          status: 'failed',
          itemsProcessed: null,
          errorMessage: 'boom',
          durationMs: expect.any(Number),
        },
      ]);
    });
  });

  describe('trackSkipped', () => {
    it('keeps the plain reason for a scheduled skip', async () => {
      await logger.trackSkipped('job-a', 'lock_not_acquired');

      expect(prisma.cron_run_log.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          status: 'skipped',
          metadata: { reason: 'lock_not_acquired' },
        }),
      });
    });

    it('marks a manual skip and records the skipped outcome', async () => {
      const ctx = manualContext();

      await runWithManualCronContext(ctx, () =>
        logger.trackSkipped('job-a', 'lock_not_acquired'),
      );

      expect(prisma.cron_run_log.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          status: 'skipped',
          metadata: {
            reason: 'lock_not_acquired',
            trigger: 'manual',
            triggered_by: 'admin-1',
          },
        }),
      });
      expect(ctx.outcomes).toEqual([
        {
          runId: 41,
          status: 'skipped',
          itemsProcessed: null,
          errorMessage: null,
          durationMs: 0,
        },
      ]);
    });
  });

  describe('queue hand-off', () => {
    it('manualTriggerPayload is empty outside a manual run', () => {
      expect(manualTriggerPayload()).toEqual({});
    });

    it('manualTriggerPayload carries the actor inside a manual run', async () => {
      const payload = await runWithManualCronContext(
        manualContext(),
        async () => manualTriggerPayload(),
      );

      expect(payload).toEqual({ manualTriggeredBy: 'admin-1' });
    });

    it('re-establishes the manual context inside the worker from the payload', async () => {
      await runWithManualTriggerFromPayload(
        { manualTriggeredBy: 'admin-2' },
        () => logger.track('job-a', async () => undefined),
      );

      expect(prisma.cron_run_log.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          metadata: { trigger: 'manual', triggered_by: 'admin-2' },
        }),
      });
    });

    it('does not mark a worker run whose payload has no manual trigger', async () => {
      await runWithManualTriggerFromPayload({}, () =>
        logger.track('job-a', async () => undefined),
      );

      expect(prisma.cron_run_log.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ metadata: Prisma.JsonNull }),
      });
    });
  });
});
