import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

export interface CronRecentRun {
  job_name: string;
  run_id: number;
  started_at: Date;
  ended_at: Date | null;
  status: string;
  duration_ms: number | null;
  items_processed: number | null;
  error_message: string | null;
}

export interface CronJobStats {
  job_name: string;
  avg_duration_ms_30d: number | null;
  failure_rate_7d: number | null;
  last_success: Date | null;
  last_failure: Date | null;
  total_runs_7d: number;
}

export interface CronRunsSummaryDto {
  recent: CronRecentRun[];
  stats: CronJobStats[];
}

export interface CronHistoryItem {
  run_id: number;
  job_name: string;
  started_at: Date;
  ended_at: Date | null;
  duration_ms: number | null;
  status: string;
  items_processed: number | null;
  error_message: string | null;
  metadata: Record<string, unknown> | null;
}

export interface CronHistoryPage {
  total: number;
  page: number;
  limit: number;
  items: CronHistoryItem[];
}

@Injectable()
export class CronRunsService {
  constructor(private readonly prisma: PrismaService) {}

  async getSummary(): Promise<CronRunsSummaryDto> {
    const recent = await this.prisma.$queryRaw<CronRecentRun[]>`
      SELECT DISTINCT ON (job_name)
        job_name, run_id, started_at, ended_at, status,
        duration_ms, items_processed, error_message
      FROM cron_run_log
      ORDER BY job_name, started_at DESC
    `;

    const stats = await this.prisma.$queryRaw<CronJobStats[]>`
      SELECT
        job_name,
        AVG(duration_ms) FILTER (WHERE started_at > NOW() - INTERVAL '30 days') AS avg_duration_ms_30d,
        (COUNT(*) FILTER (WHERE status='failed' AND started_at > NOW() - INTERVAL '7 days')::float /
          NULLIF(COUNT(*) FILTER (WHERE started_at > NOW() - INTERVAL '7 days'), 0)) AS failure_rate_7d,
        MAX(started_at) FILTER (WHERE status='completed') AS last_success,
        MAX(started_at) FILTER (WHERE status='failed') AS last_failure,
        COUNT(*) FILTER (WHERE started_at > NOW() - INTERVAL '7 days')::int AS total_runs_7d
      FROM cron_run_log
      GROUP BY job_name
    `;

    return { recent, stats };
  }

  async getHistory(params: {
    jobName?: string;
    status?: string;
    since?: string;
    until?: string;
    page?: number;
    limit?: number;
  }): Promise<CronHistoryPage> {
    const page = Math.max(1, params.page ?? 1);
    const limit = Math.min(Math.max(1, params.limit ?? 20), 100);
    const skip = (page - 1) * limit;

    const where: Prisma.cron_run_logWhereInput = {
      ...(params.jobName && { job_name: params.jobName }),
      ...(params.status && { status: params.status }),
      ...((params.since || params.until) && {
        started_at: {
          ...(params.since && { gte: new Date(params.since) }),
          ...(params.until && { lte: new Date(params.until) }),
        },
      }),
    };

    const [total, rows] = await Promise.all([
      this.prisma.cron_run_log.count({ where }),
      this.prisma.cron_run_log.findMany({
        where,
        orderBy: { started_at: 'desc' },
        skip,
        take: limit,
        select: {
          run_id: true,
          job_name: true,
          started_at: true,
          ended_at: true,
          duration_ms: true,
          status: true,
          items_processed: true,
          error_message: true,
          metadata: true,
        },
      }),
    ]);

    return {
      total,
      page,
      limit,
      items: rows.map((r) => ({
        run_id: r.run_id,
        job_name: r.job_name,
        started_at: r.started_at,
        ended_at: r.ended_at,
        duration_ms: r.duration_ms,
        status: r.status,
        items_processed: r.items_processed,
        error_message: r.error_message,
        metadata: (r.metadata as Record<string, unknown> | null) ?? null,
      })),
    };
  }
}
