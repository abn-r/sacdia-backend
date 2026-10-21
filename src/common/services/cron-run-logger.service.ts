import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import * as Sentry from '@sentry/node';
import { PrismaService } from '../../prisma/prisma.service';
import {
  manualRunMetadata,
  recordCronOutcome,
  withManualMetadata,
} from './cron-run-context';

@Injectable()
export class CronRunLogger {
  constructor(private readonly prisma: PrismaService) {}

  async track<T>(
    jobName: string,
    fn: () => Promise<T>,
    meta?: Prisma.InputJsonValue,
  ): Promise<T> {
    const startedAt = new Date();
    const row = await this.prisma.cron_run_log.create({
      data: {
        job_name: jobName,
        started_at: startedAt,
        status: 'running',
        metadata: withManualMetadata(meta),
      },
    });

    try {
      const result = await fn();
      const endedAt = new Date();
      const durationMs = endedAt.getTime() - startedAt.getTime();
      const itemsProcessed =
        (result as { itemsProcessed?: number } | undefined)?.itemsProcessed ??
        null;
      await this.prisma.cron_run_log.update({
        where: { run_id: row.run_id },
        data: {
          ended_at: endedAt,
          duration_ms: durationMs,
          status: 'completed',
          items_processed: itemsProcessed,
        },
      });
      recordCronOutcome({
        runId: row.run_id,
        status: 'completed',
        itemsProcessed,
        errorMessage: null,
        durationMs,
      });
      return result;
    } catch (err) {
      const endedAt = new Date();
      const durationMs = endedAt.getTime() - startedAt.getTime();
      const errorMessage = err instanceof Error ? err.message : String(err);
      await this.prisma.cron_run_log.update({
        where: { run_id: row.run_id },
        data: {
          ended_at: endedAt,
          duration_ms: durationMs,
          status: 'failed',
          error_message: errorMessage,
        },
      });
      recordCronOutcome({
        runId: row.run_id,
        status: 'failed',
        itemsProcessed: null,
        errorMessage,
        durationMs,
      });
      if (process.env.SENTRY_DSN) {
        Sentry.captureException(err, {
          level: 'error',
          tags: { job_name: jobName, cron: 'true', source: 'cron' },
          fingerprint: ['cron-failure', jobName],
          extra: {
            duration_ms: endedAt.getTime() - startedAt.getTime(),
            metadata: meta ?? {},
            run_id: row.run_id,
          },
        });
      }
      throw err;
    }
  }

  async trackSkipped(jobName: string, reason?: string): Promise<void> {
    const now = new Date();
    const marker = manualRunMetadata();
    const hasMarker = Object.keys(marker).length > 0;
    const row = await this.prisma.cron_run_log.create({
      data: {
        job_name: jobName,
        started_at: now,
        ended_at: now,
        duration_ms: 0,
        status: 'skipped',
        metadata:
          reason || hasMarker
            ? { ...(reason ? { reason } : {}), ...marker }
            : Prisma.JsonNull,
      },
    });
    recordCronOutcome({
      runId: row.run_id,
      status: 'skipped',
      itemsProcessed: null,
      errorMessage: null,
      durationMs: 0,
    });
  }
}
