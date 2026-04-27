import { Processor, WorkerHost, OnWorkerEvent } from '@nestjs/bullmq';
import { Logger, OnApplicationBootstrap } from '@nestjs/common';
import * as Sentry from '@sentry/node';
import { Job } from 'bullmq';
import { MonthlyReportsService } from './monthly-reports.service';
import { CronRunLogger } from '../common/services/cron-run-logger.service';

export const MONTHLY_REPORTS_QUEUE = 'monthly-reports';

export interface MonthlyReportsTriggerJobData {
  triggeredAt: string; // ISO string
}

@Processor(MONTHLY_REPORTS_QUEUE)
export class MonthlyReportsProcessor
  extends WorkerHost
  implements OnApplicationBootstrap
{
  private readonly logger = new Logger(MonthlyReportsProcessor.name);

  constructor(
    private readonly monthlyReportsService: MonthlyReportsService,
    private readonly cronLogger: CronRunLogger,
  ) {
    super();
  }

  /**
   * Attach error/stalled event listeners to the BullMQ worker so Redis
   * connection drops and job failures never emit an unhandled 'error' event,
   * which would crash the Node process.
   *
   * Must be in onApplicationBootstrap — the WorkerHost internal _worker
   * instance is only available after all modules are initialized and
   * BullRegistrar has run.
   */
  onApplicationBootstrap() {
    this.worker.on('error', (err: Error) => {
      this.logger.error(`BullMQ worker error: ${err.message}`, err.stack);
    });
  }

  async process(job: Job<MonthlyReportsTriggerJobData>): Promise<unknown> {
    this.logger.log(
      `Processing monthly-reports auto-generate job ${job.id} ` +
        `(attempt ${job.attemptsMade + 1}/${job.opts.attempts ?? 1})`,
    );

    // Delegate to MonthlyReportsService.runAutoGeneration() which contains
    // the full idempotent generation loop. CronRunLogger wraps the call so
    // cron_run_log is updated with the BullMQ job ID for traceability.
    return this.cronLogger.track(
      'monthly-reports-auto-generate',
      () => this.monthlyReportsService.runAutoGeneration(),
      { bull_job_id: job.id, triggered_at: job.data.triggeredAt },
    );
  }

  @OnWorkerEvent('failed')
  onFailed(job: Job | undefined, error: Error) {
    const attempts = job?.attemptsMade ?? 0;
    const maxAttempts = job?.opts?.attempts ?? 1;

    this.logger.error(
      `Job ${job?.id ?? 'unknown'} (${job?.name ?? 'auto-generate'}) failed ` +
        `(attempt ${attempts}/${maxAttempts}): ${error.message}`,
      error.stack,
    );

    // After max attempts are exhausted, record a final failure entry in
    // cron_run_log. Best-effort — do NOT await to avoid blocking the
    // BullMQ event loop.
    if (attempts >= maxAttempts) {
      this.cronLogger
        .trackSkipped(
          'monthly-reports-auto-generate',
          `BullMQ exhausted ${maxAttempts} attempts. Last error: ${error.message}`,
        )
        .catch((logErr: Error) =>
          this.logger.warn(
            `Failed to write exhausted-retry log: ${logErr.message}`,
          ),
        );
    }

    if (process.env.SENTRY_DSN) {
      Sentry.captureException(error, {
        tags: {
          bullmq: true,
          queue: MONTHLY_REPORTS_QUEUE,
          job_name: job?.name ?? 'auto-generate',
        },
        extra: {
          job_id: job?.id,
          attempts,
          max_attempts: maxAttempts,
          failed_reason: job?.failedReason,
        },
      });
    }
  }
}
