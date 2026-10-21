import { Injectable, Logger } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { AuditLogsService } from '../../audit-logs/audit-logs.service';
import { AppNotFoundException } from '../../common/errors/app.exception';
import { ErrorCode } from '../../common/errors/error-codes';
import {
  runWithManualCronContext,
  type CronRunOutcome,
  type CronRunStatus,
  type ManualCronContext,
} from '../../common/services/cron-run-context';
import { CronRunLogger } from '../../common/services/cron-run-logger.service';
import { DistributedLockService } from '../../common/services/distributed-lock.service';
import {
  CRON_JOB_DEFINITIONS,
  describeCronJob,
  findCronJob,
  type CronJobDefinition,
  type CronJobListItem,
} from './cron-job.registry';

/**
 * Safety net for the manual-run lock: it is always released in `finally`, the
 * TTL only matters if the process dies mid-run. Longer than the slowest job
 * we expect to await in a request.
 */
const MANUAL_RUN_LOCK_TTL_MS = 10 * 60 * 1000;

export interface CronJobRunResult {
  job_name: string;
  /** cron_run_log row of the run; null when the job writes none (or enqueued). */
  run_id: number | null;
  status: CronRunStatus;
  items_processed: number | null;
  duration_ms: number;
  error_message: string | null;
  /**
   * true when the handler only enqueued the work in BullMQ: the worker
   * finishes it later and writes its own (manual-marked) cron_run_log row.
   */
  enqueued: boolean;
}

type CronHandler = () => Promise<unknown>;

@Injectable()
export class AdminCronJobsService {
  private readonly logger = new Logger(AdminCronJobsService.name);

  constructor(
    private readonly moduleRef: ModuleRef,
    private readonly lockService: DistributedLockService,
    private readonly cronLogger: CronRunLogger,
    private readonly auditLogs: AuditLogsService,
  ) {}

  list(): CronJobListItem[] {
    return CRON_JOB_DEFINITIONS.map((def) => ({
      ...describeCronJob(def),
      runnable: this.resolveProvider(def) !== null,
    }));
  }

  /**
   * Runs one allowlisted job NOW through the exact method the `@Cron`
   * decorator invokes (same distributed lock, same CronRunLogger), awaited.
   * The request lasts as long as the job; inline jobs that walk every club can
   * take a while on a large dataset.
   */
  async run(jobName: string, actorUserId: string): Promise<CronJobRunResult> {
    const def = findCronJob(jobName);
    const provider = def ? this.resolveProvider(def) : null;
    if (!def || !provider) {
      throw new AppNotFoundException(ErrorCode.CRON_JOB_NOT_FOUND, { jobName });
    }

    const handler = (provider as Record<string, unknown>)[def.method] as
      CronHandler | undefined;
    if (typeof handler !== 'function') {
      throw new AppNotFoundException(ErrorCode.CRON_JOB_NOT_FOUND, { jobName });
    }

    const context: ManualCronContext = {
      triggeredBy: actorUserId,
      outcomes: [],
    };
    const startedAt = Date.now();
    const failure = await runWithManualCronContext(context, () =>
      this.invoke(def, () => handler.call(provider)),
    );

    const result = this.toResult(
      def,
      context.outcomes.at(-1),
      failure,
      Date.now() - startedAt,
    );
    await this.audit(actorUserId, result);
    return result;
  }

  /** Runs the handler under the manual lock; resolves to its error, if any. */
  private async invoke(
    def: CronJobDefinition,
    call: () => Promise<unknown>,
  ): Promise<Error | null> {
    const lockKey = `cron-manual:${def.jobName}`;
    const acquired = await this.lockService.tryAcquire(
      lockKey,
      MANUAL_RUN_LOCK_TTL_MS,
    );
    if (!acquired) {
      await this.cronLogger.trackSkipped(def.jobName, 'manual_run_in_progress');
      return null;
    }

    try {
      await call();
      return null;
    } catch (error) {
      // Handlers swallow their own errors after logging them; one that
      // rethrows (e.g. an unguarded inline run) still ends in a failed result.
      this.logger.error(
        `Manual run of "${def.jobName}" failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return error instanceof Error ? error : new Error(String(error));
    } finally {
      await this.lockService.release(lockKey);
    }
  }

  private toResult(
    def: CronJobDefinition,
    outcome: CronRunOutcome | undefined,
    failure: Error | null,
    durationMs: number,
  ): CronJobRunResult {
    if (failure) {
      return {
        job_name: def.jobName,
        run_id: outcome?.runId ?? null,
        status: 'failed',
        items_processed: outcome?.itemsProcessed ?? null,
        duration_ms: durationMs,
        error_message: failure.message,
        enqueued: false,
      };
    }
    if (outcome) {
      return {
        job_name: def.jobName,
        run_id: outcome.runId,
        status: outcome.status,
        items_processed: outcome.itemsProcessed,
        duration_ms: durationMs,
        error_message: outcome.errorMessage,
        enqueued: false,
      };
    }
    // No cron_run_log row was written during the request: either the handler
    // enqueued the work in BullMQ, or the job does not log its runs.
    return {
      job_name: def.jobName,
      run_id: null,
      status: 'completed',
      items_processed: null,
      duration_ms: durationMs,
      error_message: null,
      enqueued: def.queueBacked === true,
    };
  }

  private async audit(
    actorUserId: string,
    result: CronJobRunResult,
  ): Promise<void> {
    await this.auditLogs.recordEvent({
      entity_type: 'cron_job',
      entity_id: result.job_name,
      action: 'admin.cron_job.run',
      actor_user_id: actorUserId,
      actor_kind: 'user',
      result: result.status === 'failed' ? 'failed' : 'succeeded',
      summary: `Manual run of cron job ${result.job_name}: ${result.status}`,
      changes: {
        job_name: result.job_name,
        status: result.status,
        run_id: result.run_id,
        items_processed: result.items_processed,
        duration_ms: result.duration_ms,
        error_message: result.error_message,
      },
    });
  }

  /** The live provider that owns the `@Cron` method, or null if not running. */
  private resolveProvider(def: CronJobDefinition): object | null {
    try {
      return this.moduleRef.get<object>(def.target, { strict: false });
    } catch {
      return null;
    }
  }
}
