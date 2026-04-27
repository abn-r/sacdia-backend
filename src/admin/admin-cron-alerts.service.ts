import { Injectable, Logger } from '@nestjs/common';
import { AppNotFoundException } from '../common/errors/app.exception';
import { ErrorCode } from '../common/errors/error-codes';
import { PrismaService } from '../prisma/prisma.service';

export interface CronAlertItem {
  id: number;
  job_name: string;
  condition: string;
  details: Record<string, unknown> | null;
  alerted_at: Date;
  resolved_at: Date | null;
}

export interface CronAlertHistoryPage {
  total: number;
  page: number;
  limit: number;
  items: CronAlertItem[];
}

@Injectable()
export class AdminCronAlertsService {
  private readonly logger = new Logger(AdminCronAlertsService.name);

  constructor(private readonly prisma: PrismaService) {}

  // ─────────────────────────────────────────────────────────────────────────
  // getAlertHistory — paginated list of cron_alerts_log
  // Using raw SQL because Prisma client regeneration requires prisma generate.
  // ─────────────────────────────────────────────────────────────────────────

  async getAlertHistory(params: {
    jobName?: string;
    since?: string;
    unresolved?: boolean;
    page?: number;
    limit?: number;
  }): Promise<CronAlertHistoryPage> {
    const page = Math.max(1, params.page ?? 1);
    const limit = Math.min(Math.max(1, params.limit ?? 20), 100);
    const offset = (page - 1) * limit;

    // Build dynamic where conditions
    const conditions: string[] = [];
    const values: unknown[] = [];
    let idx = 1;

    if (params.jobName) {
      conditions.push(`job_name = $${idx++}`);
      values.push(params.jobName);
    }

    if (params.since) {
      conditions.push(`alerted_at >= $${idx++}`);
      values.push(new Date(params.since));
    }

    if (params.unresolved) {
      conditions.push(`resolved_at IS NULL`);
    }

    const whereClause =
      conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    // Count query
    const countRows = await this.prisma.$queryRawUnsafe<
      Array<{ count: bigint }>
    >(
      `SELECT COUNT(*) AS count FROM cron_alerts_log ${whereClause}`,
      ...values,
    );
    const total = Number(countRows[0]?.count ?? 0);

    // Data query
    const rows = await this.prisma.$queryRawUnsafe<CronAlertItem[]>(
      `SELECT id, job_name, condition, details, alerted_at, resolved_at
       FROM cron_alerts_log
       ${whereClause}
       ORDER BY alerted_at DESC
       LIMIT $${idx++} OFFSET $${idx++}`,
      ...values,
      limit,
      offset,
    );

    return {
      total,
      page,
      limit,
      items: rows.map((r) => ({
        id: r.id,
        job_name: r.job_name,
        condition: r.condition,
        details: (r.details as Record<string, unknown> | null) ?? null,
        alerted_at: r.alerted_at,
        resolved_at: r.resolved_at,
      })),
    };
  }

  // ─────────────────────────────────────────────────────────────────────────
  // resolveAlert — set resolved_at on an open alert
  // ─────────────────────────────────────────────────────────────────────────

  async resolveAlert(id: number, actorId: string): Promise<CronAlertItem> {
    const existing = await this.prisma.$queryRaw<CronAlertItem[]>`
      SELECT id, job_name, condition, details, alerted_at, resolved_at
      FROM cron_alerts_log
      WHERE id = ${id}
    `;

    if (!existing.length) {
      throw new AppNotFoundException(ErrorCode.CRON_ALERT_NOT_FOUND);
    }

    const updated = await this.prisma.$queryRaw<CronAlertItem[]>`
      UPDATE cron_alerts_log
      SET resolved_at = NOW()
      WHERE id = ${id}
      RETURNING id, job_name, condition, details, alerted_at, resolved_at
    `;

    const row = updated[0];

    this.logger.log(
      `CronAlert id=${id} resolved by actor=${actorId} job=${row.job_name} condition=${row.condition}`,
    );

    return {
      id: row.id,
      job_name: row.job_name,
      condition: row.condition,
      details: (row.details as Record<string, unknown> | null) ?? null,
      alerted_at: row.alerted_at,
      resolved_at: row.resolved_at,
    };
  }
}
