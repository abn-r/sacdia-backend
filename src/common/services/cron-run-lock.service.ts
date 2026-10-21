import { Injectable, Logger } from '@nestjs/common';
import { getManualCronContext } from './cron-run-context';
import { CronRunLogger } from './cron-run-logger.service';
import { DistributedLockService } from './distributed-lock.service';

/**
 * The ONE lock a job takes for a run, whoever starts it: the `@Cron` tick or
 * the super-admin's "Ejecutar ahora" (`POST /admin/cron-jobs/:job/run`).
 */
export function cronRunLockKey(jobName: string): string {
  return `cron-run:${jobName}`;
}

export interface RunExclusiveOptions {
  /**
   * The job writes `cron_run_log` rows. When true (default) a skipped tick
   * leaves a `skipped` row there; when false only a warning is logged. A manual
   * run always records its `skipped` row: the admin gets it back as the result.
   */
  logsRuns?: boolean;
}

export type ExclusiveRunResult<T> = { ran: true; value: T } | { ran: false };

/**
 * CronRunLock
 *
 * Makes overlapping runs of the same job skip instead of duplicating their
 * side effects. Built on the atomic owner-checked lock of
 * {@link DistributedLockService} (SET NX PX + compare-and-delete), so two
 * instances can never both win and a run that outlives its TTL cannot free the
 * lock of the run that replaced it.
 *
 * Who uses it:
 * - Jobs WITHOUT a lock of their own wrap their `@Cron` body in
 *   {@link runExclusive} (member-of-month, cron-alert-check, the cleanups...).
 * - The manual-run endpoint wraps EVERY job in it, which is the atomic guard
 *   against a double click or a manual run landing on a scheduled tick.
 * - Jobs that already take their own `cron:<job>` lock via `tryAcquire` keep
 *   it untouched. The manual run holds both keys; the scheduled tick only the
 *   job's own one. Either order of overlap ends in a skip, and since the
 *   scheduled tick never touches `cron-run:<job>` there is nothing to deadlock.
 *
 * Re-entrancy: a manual run takes the lock in the endpoint and then invokes
 * the handler, which wraps itself again. The lock is not re-entrant, so the
 * holder is recorded in the manual run's async context and the nested call
 * runs straight through. Scheduled ticks have no such context.
 */
@Injectable()
export class CronRunLock {
  private readonly logger = new Logger(CronRunLock.name);

  constructor(
    private readonly lockService: DistributedLockService,
    private readonly cronLogger: CronRunLogger,
  ) {}

  /**
   * Runs `fn` while holding the run lock of `jobName`.
   *
   * @param ttlMs Safety net for a dead process only (the lock is released in
   *              `finally`). Pick it longer than the worst-case runtime: a run
   *              that outlives it stops being exclusive. For frequent jobs keep
   *              it below the schedule interval so a crash never costs a tick.
   * @returns `{ ran: false }` when another run holds the lock; otherwise the
   *          value of `fn`. Errors of `fn` propagate (the lock is released).
   */
  async runExclusive<T>(
    jobName: string,
    ttlMs: number,
    fn: () => Promise<T>,
    options: RunExclusiveOptions = {},
  ): Promise<ExclusiveRunResult<T>> {
    const context = getManualCronContext();
    if (context?.heldRunLocks?.has(jobName)) {
      return { ran: true, value: await fn() };
    }

    const lock = await this.lockService.tryAcquireOwned(
      cronRunLockKey(jobName),
      ttlMs,
    );
    if (!lock) {
      await this.recordSkip(jobName, options.logsRuns ?? true, !!context);
      return { ran: false };
    }

    if (context) {
      context.heldRunLocks ??= new Set();
      context.heldRunLocks.add(jobName);
    }
    try {
      return { ran: true, value: await fn() };
    } finally {
      context?.heldRunLocks?.delete(jobName);
      await this.lockService.releaseOwned(lock);
    }
  }

  private async recordSkip(
    jobName: string,
    logsRuns: boolean,
    manual: boolean,
  ): Promise<void> {
    this.logger.warn(
      `Skipping "${jobName}": another run of the job holds its run lock`,
    );
    if (!logsRuns && !manual) {
      return;
    }
    try {
      await this.cronLogger.trackSkipped(jobName, 'run_lock_held');
    } catch (error) {
      this.logger.warn(
        `Could not record the skipped run of "${jobName}": ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }
}
