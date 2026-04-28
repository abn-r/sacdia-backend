import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

const DEFAULT_DEADLINE_DAY = 5;
const SYSTEM_CONFIG_KEY = 'ranking.finance_closing_deadline_day';

@Injectable()
export class FinanceScoreService {
  private readonly logger = new Logger(FinanceScoreService.name);

  constructor(private readonly prisma: PrismaService) {}

  async calc(clubId: number, year: number): Promise<number> {
    const deadlineDay = await this.resolveDeadlineDay();

    const rows = await this.prisma.$queryRaw<{ count: bigint }[]>`
      SELECT COUNT(*)::bigint AS count
      FROM finance_period_closings
      WHERE club_id = ${clubId}
        AND year = ${year}
        AND closed_at IS NOT NULL
        AND closed_at <= (make_timestamptz(year, month + 1, ${deadlineDay}, 23, 59, 59, 'UTC') AT TIME ZONE 'UTC')
    `;

    const monthsClosedOnTime = Number(rows[0]?.count ?? 0n);
    const score = Math.min((monthsClosedOnTime / 12) * 100, 100);
    return Number(score.toFixed(2));
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
    if (Number.isNaN(parsed)) {
      this.logger.warn(
        `system_config[${SYSTEM_CONFIG_KEY}] not numeric ("${row.config_value}"), using default ${DEFAULT_DEADLINE_DAY}`,
      );
      return DEFAULT_DEADLINE_DAY;
    }
    return parsed;
  }
}
