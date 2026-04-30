import { Processor, WorkerHost, OnWorkerEvent } from '@nestjs/bullmq';
import { Logger, OnApplicationBootstrap } from '@nestjs/common';
import * as Sentry from '@sentry/node';
import { Job } from 'bullmq';
import { RankingsService } from './rankings.service';
import { CronRunLogger } from '../common/services/cron-run-logger.service';
import { RANKINGS_QUEUE, RankingsTriggerJobData } from './rankings.types';

export { RANKINGS_QUEUE };
export type { RankingsTriggerJobData };

@Processor(RANKINGS_QUEUE)
export class RankingsProcessor
  extends WorkerHost
  implements OnApplicationBootstrap
{
  private readonly logger = new Logger(RankingsProcessor.name);

  constructor(
    private readonly rankingsService: RankingsService,
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

  async process(job: Job<RankingsTriggerJobData>): Promise<unknown> {
    this.logger.log(
      `Processing rankings recalculation job ${job.id} ` +
        `(attempt ${job.attemptsMade + 1}/${job.opts.attempts ?? 1})`,
    );

    // recalculateAll() is the full orchestrator (club + enrollment + section steps).
    // recalculateRankings() acquires a per-year distributed lock for step 1 —
    // the idempotency guard is already in place. BullMQ retry will call this
    // again on failure; if a previous attempt is somehow still running the
    // lock prevents concurrent duplication (throws AppConflictException).
    // That exception propagates to BullMQ which will retry with backoff.
    return this.cronLogger.track(
      'rankings-recalculate',
      async () => {
        await this.rankingsService.recalculateAll();
        this.logger.log('Rankings recalculation (all steps) completed');
        return { itemsProcessed: 1 };
      },
      { bull_job_id: job.id, triggered_at: job.data.triggeredAt },
    );
  }

  @OnWorkerEvent('failed')
  onFailed(job: Job | undefined, error: Error) {
    const attempts = job?.attemptsMade ?? 0;
    const maxAttempts = job?.opts?.attempts ?? 1;

    this.logger.error(
      `Job ${job?.id ?? 'unknown'} (${job?.name ?? 'recalculate'}) failed ` +
        `(attempt ${attempts}/${maxAttempts}): ${error.message}`,
      error.stack,
    );

    if (attempts >= maxAttempts) {
      this.cronLogger
        .trackSkipped(
          'rankings-recalculate',
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
          queue: RANKINGS_QUEUE,
          job_name: job?.name ?? 'recalculate',
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
