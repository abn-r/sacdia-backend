import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import * as Sentry from '@sentry/node';
import { PrismaService } from '../../prisma/prisma.service';

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
        metadata: meta ?? Prisma.JsonNull,
      },
    });

    try {
      const result = await fn();
      const endedAt = new Date();
      await this.prisma.cron_run_log.update({
        where: { run_id: row.run_id },
        data: {
          ended_at: endedAt,
          duration_ms: endedAt.getTime() - startedAt.getTime(),
          status: 'completed',
          items_processed:
            (result as { itemsProcessed?: number } | undefined)
              ?.itemsProcessed ?? null,
        },
      });
      return result;
    } catch (err) {
      const endedAt = new Date();
      await this.prisma.cron_run_log.update({
        where: { run_id: row.run_id },
        data: {
          ended_at: endedAt,
          duration_ms: endedAt.getTime() - startedAt.getTime(),
          status: 'failed',
          error_message: err instanceof Error ? err.message : String(err),
        },
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
    await this.prisma.cron_run_log.create({
      data: {
        job_name: jobName,
        started_at: now,
        ended_at: now,
        duration_ms: 0,
        status: 'skipped',
        metadata: reason ? { reason } : Prisma.JsonNull,
      },
    });
  }
}
