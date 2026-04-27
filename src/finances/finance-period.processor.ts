import { Processor, WorkerHost, OnWorkerEvent } from '@nestjs/bullmq';
import { Logger, OnApplicationBootstrap } from '@nestjs/common';
import * as Sentry from '@sentry/node';
import { Job } from 'bullmq';
import { FinancePeriodService } from './finance-period.service';
import { CronRunLogger } from '../common/services/cron-run-logger.service';

export const FINANCE_PERIOD_QUEUE = 'finance-period';

export interface FinancePeriodTriggerJobData {
  triggeredAt: string; // ISO string
  year: number;
  month: number;
}

@Processor(FINANCE_PERIOD_QUEUE)
export class FinancePeriodProcessor
  extends WorkerHost
  implements OnApplicationBootstrap
{
  private readonly logger = new Logger(FinancePeriodProcessor.name);

  constructor(
    private readonly financePeriodService: FinancePeriodService,
    private readonly cronLogger: CronRunLogger,
  ) {
    super();
  }

  /**
   * Attach error/stalled event listeners to the BullMQ worker so Redis
   * connection drops and job failures never emit an unhandled 'error' event.
   */
  onApplicationBootstrap() {
    this.worker.on('error', (err: Error) => {
      this.logger.error(`BullMQ worker error: ${err.message}`, err.stack);
    });
  }

  async process(job: Job<FinancePeriodTriggerJobData>): Promise<unknown> {
    const { year, month } = job.data;
    const period = `${year}-${String(month).padStart(2, '0')}`;

    this.logger.log(
      `Processing finance-period closing job ${job.id} for ${period} ` +
        `(attempt ${job.attemptsMade + 1}/${job.opts.attempts ?? 1})`,
    );

    // Delegates to FinancePeriodService.runMonthlyClosing() which owns the
    // batched loop. closeMonthForClub() is idempotent — already-closed periods
    // return null and are skipped, making BullMQ retries safe.
    return this.financePeriodService.runMonthlyClosing(year, month);
  }

  @OnWorkerEvent('failed')
  onFailed(job: Job | undefined, error: Error) {
    const attempts = job?.attemptsMade ?? 0;
    const maxAttempts = job?.opts?.attempts ?? 1;

    this.logger.error(
      `Job ${job?.id ?? 'unknown'} (${job?.name ?? 'close-month'}) failed ` +
        `(attempt ${attempts}/${maxAttempts}): ${error.message}`,
      error.stack,
    );

    if (attempts >= maxAttempts) {
      const data = job?.data as FinancePeriodTriggerJobData | undefined;
      const period = data
        ? `${data.year}-${String(data.month).padStart(2, '0')}`
        : 'unknown';

      this.cronLogger
        .trackSkipped(
          'finance-period-closing',
          `BullMQ exhausted ${maxAttempts} attempts for period ${period}. Last error: ${error.message}`,
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
          queue: FINANCE_PERIOD_QUEUE,
          job_name: job?.name ?? 'close-month',
        },
        extra: {
          job_id: job?.id,
          attempts,
          max_attempts: maxAttempts,
          failed_reason: job?.failedReason,
          job_data: job?.data,
        },
      });
    }
  }
}
