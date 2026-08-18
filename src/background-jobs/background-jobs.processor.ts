import { Processor, WorkerHost, OnWorkerEvent } from '@nestjs/bullmq';
import { Logger, OnApplicationBootstrap } from '@nestjs/common';
import * as Sentry from '@sentry/node';
import { Job } from 'bullmq';
import { MonthlyReportsService } from '../monthly-reports/monthly-reports.service';
import { FinancePeriodService } from '../finances/finance-period.service';
import { RankingsService } from '../annual-folders/rankings.service';
import { DataExportService } from '../data-export/data-export.service';
import { CronRunLogger } from '../common/services/cron-run-logger.service';
import { AppException } from '../common/errors/app.exception';
import { ErrorCode } from '../common/errors/error-codes';
import {
  BACKGROUND_JOBS_QUEUE,
  BackgroundJobName,
  BackgroundJobPayloadMap,
  MAP_JOB_TO_CRON_KEY,
} from './background-jobs.types';

const SKIPPABLE_MONTHLY_PDF_CODES: ReadonlySet<ErrorCode> = new Set([
  ErrorCode.MONTHLY_REPORT_NOT_DRAFT,
  ErrorCode.MONTHLY_REPORT_NOT_FOUND,
  ErrorCode.REPORT_PDF_NOT_GENERATED,
  ErrorCode.REPORT_PDF_NO_SNAPSHOT,
]);

function isSkippableMonthlyPdfError(error: unknown): boolean {
  return (
    error instanceof AppException && SKIPPABLE_MONTHLY_PDF_CODES.has(error.code)
  );
}

@Processor(BACKGROUND_JOBS_QUEUE)
export class BackgroundJobsProcessor
  extends WorkerHost
  implements OnApplicationBootstrap
{
  private readonly logger = new Logger(BackgroundJobsProcessor.name);

  constructor(
    private readonly monthlyReportsService: MonthlyReportsService,
    private readonly financePeriodService: FinancePeriodService,
    private readonly rankingsService: RankingsService,
    private readonly dataExportService: DataExportService,
    private readonly cronLogger: CronRunLogger,
  ) {
    super();
  }

  /**
   * Attach an error listener to the BullMQ worker so Redis connection drops
   * never emit an unhandled 'error' event that would crash the Node process.
   *
   * Must run in onApplicationBootstrap — the WorkerHost internal _worker
   * instance is only available after all modules have been initialized and
   * BullRegistrar has run.
   */
  onApplicationBootstrap() {
    this.worker.on('error', (err: Error) => {
      this.logger.error(`BullMQ worker error: ${err.message}`, err.stack);
    });
  }

  async process(job: Job<unknown>): Promise<unknown> {
    const name = job.name as BackgroundJobName;

    this.logger.log(
      `Processing background job "${name}" id=${job.id} ` +
        `(attempt ${job.attemptsMade + 1}/${job.opts.attempts ?? 1})`,
    );

    switch (name) {
      case BackgroundJobName.MONTHLY_REPORTS_AUTO_GENERATE: {
        const data =
          job.data as BackgroundJobPayloadMap[typeof BackgroundJobName.MONTHLY_REPORTS_AUTO_GENERATE];
        return this.cronLogger.track(
          MAP_JOB_TO_CRON_KEY[BackgroundJobName.MONTHLY_REPORTS_AUTO_GENERATE]!,
          () => this.monthlyReportsService.runAutoGeneration(),
          { bull_job_id: job.id, triggered_at: data.triggeredAt },
        );
      }

      case BackgroundJobName.MONTHLY_REPORT_PDF: {
        const data =
          job.data as BackgroundJobPayloadMap[typeof BackgroundJobName.MONTHLY_REPORT_PDF];
        try {
          if (data.action === 'regenerate') {
            await this.monthlyReportsService.regenerate(data.reportId);
          } else {
            await this.monthlyReportsService.generate(
              data.reportId,
              data.requestedBy ?? 'system',
            );
          }
          return { reportId: data.reportId, action: data.action };
        } catch (error) {
          if (isSkippableMonthlyPdfError(error)) {
            this.logger.warn(
              `Skipping monthly PDF job ${data.action} for ${data.reportId}: ${
                error instanceof AppException ? error.code : 'unknown'
              }`,
            );
            return {
              skipped: true,
              reportId: data.reportId,
              action: data.action,
            };
          }
          throw error;
        }
      }

      case BackgroundJobName.FINANCE_PERIOD_CLOSE_MONTH: {
        const data =
          job.data as BackgroundJobPayloadMap[typeof BackgroundJobName.FINANCE_PERIOD_CLOSE_MONTH];
        return this.financePeriodService.runMonthlyClosing(
          data.year,
          data.month,
        );
      }

      case BackgroundJobName.RANKINGS_RECALCULATE: {
        const data =
          job.data as BackgroundJobPayloadMap[typeof BackgroundJobName.RANKINGS_RECALCULATE];
        return this.cronLogger.track(
          MAP_JOB_TO_CRON_KEY[BackgroundJobName.RANKINGS_RECALCULATE]!,
          async () => {
            if (data.includeMemberRankings) {
              await this.rankingsService.recalculateAll(
                data.yearId,
                data.mode ?? 'full',
              );
              this.logger.log(
                `Club + member rankings recalculated for year=${data.yearId ?? 'active'} mode=${data.mode ?? 'full'}`,
              );
              return { itemsProcessed: 0, includeMemberRankings: true };
            }
            const result = await this.rankingsService.recalculateRankings(
              data.yearId,
            );
            this.logger.log(`Rankings recalculated: ${result.updated} records`);
            return { itemsProcessed: result.updated };
          },
          { bull_job_id: job.id, triggered_at: data.triggeredAt },
        );
      }

      case BackgroundJobName.DATA_EXPORT_GENERATE: {
        const data =
          job.data as BackgroundJobPayloadMap[typeof BackgroundJobName.DATA_EXPORT_GENERATE];
        return this.dataExportService.runExport(data.exportId, data.userId);
      }

      default: {
        // Exhaustiveness check — TypeScript should prevent reaching here
        const _exhaustive: never = name;
        throw new Error(`Unknown background job name: ${String(_exhaustive)}`);
      }
    }
  }

  @OnWorkerEvent('failed')
  onFailed(job: Job | undefined, error: Error) {
    const attempts = job?.attemptsMade ?? 0;
    const maxAttempts = job?.opts?.attempts ?? 1;

    this.logger.error(
      `Job ${job?.id ?? 'unknown'} ("${job?.name ?? 'unknown'}") failed ` +
        `(attempt ${attempts}/${maxAttempts}): ${error.message}`,
      error.stack,
    );

    // After max attempts are exhausted, record a final failure in cron_run_log
    // — only for cron-backed jobs (data-export / monthly PDF have no cron key).
    // Best-effort: do NOT await to avoid blocking the BullMQ event loop.
    if (job && attempts >= maxAttempts) {
      const cronKey = MAP_JOB_TO_CRON_KEY[job.name as BackgroundJobName];
      if (cronKey) {
        this.cronLogger
          .trackSkipped(
            cronKey,
            `BullMQ exhausted ${maxAttempts} attempts. Last error: ${error.message}`,
          )
          .catch((logErr: Error) =>
            this.logger.warn(
              `Failed to write exhausted-retry log: ${logErr.message}`,
            ),
          );
      }
    }

    if (process.env.SENTRY_DSN) {
      Sentry.captureException(error, {
        tags: {
          bullmq: true,
          queue: BACKGROUND_JOBS_QUEUE,
          job_name: job?.name ?? 'unknown',
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
