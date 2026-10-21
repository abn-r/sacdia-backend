import { recordCronOutcome } from './cron-run-context';
import { CronRunLock, cronRunLockKey } from './cron-run-lock.service';
import { DistributedLockService } from './distributed-lock.service';

/**
 * Test helper: a real {@link CronRunLock} on top of a real
 * {@link DistributedLockService} (its in-memory fallback, as in dev without
 * Redis), so specs exercise the exact atomic lock the scheduler and the manual
 * run share. `holdRunLock` plays "the other run" (a manual run, or a tick).
 * Excluded from the production build (`*.testing.ts`).
 */
export function buildCronRunLockHarness() {
  const lockService = new DistributedLockService({
    get: jest.fn(),
    set: jest.fn(),
    del: jest.fn(),
  } as never);
  // Like the real CronRunLogger, a skipped row is reported to a manual run.
  const cronLogger = {
    trackSkipped: jest.fn((): Promise<void> => {
      recordCronOutcome({
        runId: 900,
        status: 'skipped',
        itemsProcessed: null,
        errorMessage: null,
        durationMs: 0,
      });
      return Promise.resolve();
    }),
  };
  const runLock = new CronRunLock(lockService, cronLogger as never);

  return {
    runLock,
    lockService,
    cronLogger,
    /** Takes the run lock of `jobName` as if another run were in flight. */
    holdRunLock: async (jobName: string) => {
      const lock = await lockService.tryAcquireOwned(
        cronRunLockKey(jobName),
        60_000,
      );
      if (!lock) {
        throw new Error(`run lock of ${jobName} was already held`);
      }
      return lock;
    },
    /** true when the run lock of `jobName` is free (nobody holds it). */
    isRunLockFree: async (jobName: string) => {
      const lock = await lockService.tryAcquireOwned(
        cronRunLockKey(jobName),
        60_000,
      );
      if (lock) {
        await lockService.releaseOwned(lock);
      }
      return lock !== null;
    },
  };
}
