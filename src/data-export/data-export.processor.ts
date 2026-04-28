import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger, OnApplicationBootstrap } from '@nestjs/common';
import * as Sentry from '@sentry/node';
import { Job } from 'bullmq';
import { DataExportService } from './data-export.service';

export const DATA_EXPORTS_QUEUE = 'data-exports';
export const DATA_EXPORT_GENERATE_JOB = 'data-export.generate';

export interface DataExportGenerateJobData {
  exportId: string;
  userId: string;
}

/**
 * Thin BullMQ processor that delegates all business logic to
 * DataExportService.runExport(). The full pipeline (fetch → build → upload
 * → email) lives in the service so it can be reused by
 * BackgroundJobsProcessor once the queue is consolidated.
 *
 * @deprecated This processor will be removed in the background-jobs queue
 * consolidation. New enqueue sites should use BACKGROUND_JOBS_QUEUE with
 * BackgroundJobName.DATA_EXPORT_GENERATE.
 */
@Processor(DATA_EXPORTS_QUEUE)
export class DataExportProcessor
  extends WorkerHost
  implements OnApplicationBootstrap
{
  private readonly logger = new Logger(DataExportProcessor.name);

  constructor(private readonly dataExportService: DataExportService) {
    super();
  }

  onApplicationBootstrap() {
    this.worker.on('error', (err: Error) => {
      this.logger.error(`DataExport worker error: ${err.message}`, err.stack);
    });

    this.worker.on('failed', (job: Job | undefined, err: Error) => {
      this.logger.error(
        `DataExport job ${job?.id ?? 'unknown'} failed: ${err.message}`,
      );
      if (process.env.SENTRY_DSN) {
        Sentry.captureException(err, {
          tags: {
            bullmq: true,
            queue: job?.queueName ?? 'unknown',
            job_name: job?.name ?? 'unknown',
          },
          extra: {
            job_id: job?.id,
            attempts: job?.attemptsMade,
            failed_reason: job?.failedReason,
          },
        });
      }
    });
  }

  async process(
    job: Job<
      DataExportGenerateJobData,
      unknown,
      typeof DATA_EXPORT_GENERATE_JOB
    >,
  ) {
    const { exportId, userId } = job.data;
    this.logger.log(
      `Processing data export job: exportId=${exportId}, userId=${userId}`,
    );
    return this.dataExportService.runExport(exportId, userId);
  }
}
