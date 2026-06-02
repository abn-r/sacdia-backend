import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

const DEFAULT_DEADLINE_DAY = 5;
const SYSTEM_CONFIG_KEY = 'ranking.monthly_report_deadline_day';

@Injectable()
export class MonthlyReportsTimelinessScoreService {
  private readonly logger = new Logger(MonthlyReportsTimelinessScoreService.name);

  constructor(private readonly prisma: PrismaService) {}

  async calc(
    clubEnrollmentId: string,
    ecclesiasticalYearId: number,
  ): Promise<number> {
    const deadlineDay = await this.resolveDeadlineDay();

    const rows = await this.prisma.$queryRaw<
      { submitted_on_time: bigint; expected_months: bigint }[]
    >`
      WITH year_scope AS (
        SELECT start_date, end_date
        FROM ecclesiastical_years
        WHERE year_id = ${ecclesiasticalYearId}
        LIMIT 1
      ),
      months AS (
        SELECT month_start::date AS month_start
        FROM year_scope ys,
          generate_series(
            date_trunc('month', ys.start_date)::date,
            date_trunc('month', ys.end_date)::date,
            interval '1 month'
          ) AS month_start
      ),
      month_deadlines AS (
        SELECT
          month_start,
          LEAST(
            ${deadlineDay}::int,
            EXTRACT(
              DAY FROM (date_trunc('month', month_start) + interval '1 month' - interval '1 day')
            )::int
          ) AS deadline_day
        FROM months
      )
      SELECT
        COUNT(md.month_start)::bigint AS expected_months,
        COUNT(mr.monthly_report_id) FILTER (
          WHERE mr.status = 'submitted'
            AND mr.submitted_at IS NOT NULL
            AND mr.submitted_at <= make_timestamptz(
              EXTRACT(YEAR FROM md.month_start)::int,
              EXTRACT(MONTH FROM md.month_start)::int,
              md.deadline_day,
              23,
              59,
              59,
              'UTC'
            )
        )::bigint AS submitted_on_time
      FROM month_deadlines md
      LEFT JOIN monthly_reports mr
        ON mr.club_enrollment_id = ${clubEnrollmentId}::uuid
       AND mr.month = EXTRACT(MONTH FROM md.month_start)::int
       AND mr.year = EXTRACT(YEAR FROM md.month_start)::int
    `;

    const submittedOnTime = Number(rows[0]?.submitted_on_time ?? 0n);
    const expectedMonths = Number(rows[0]?.expected_months ?? 0n);
    if (expectedMonths <= 0) return 0;

    return this.normalizePercentage((submittedOnTime / expectedMonths) * 100);
  }

  private async resolveDeadlineDay(): Promise<number> {
    const row = await this.prisma.system_config.findUnique({
      where: { config_key: SYSTEM_CONFIG_KEY },
    });
    if (!row) {
      this.logger.warn(
        `system_config[${SYSTEM_CONFIG_KEY}] missing, using default ${DEFAULT_DEADLINE_DAY}`,
      );
      return DEFAULT_DEADLINE_DAY;
    }

    const parsed = parseInt(row.config_value, 10);
    if (!Number.isInteger(parsed) || parsed < 1 || parsed > 31) {
      this.logger.warn(
        `system_config[${SYSTEM_CONFIG_KEY}] invalid ("${row.config_value}"), using default ${DEFAULT_DEADLINE_DAY}`,
      );
      return DEFAULT_DEADLINE_DAY;
    }

    return parsed;
  }

  private normalizePercentage(value: number): number {
    if (!Number.isFinite(value)) return 0;
    return Math.max(0, Math.min(100, Number(value.toFixed(2))));
  }
}
