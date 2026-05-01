import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  DailyDeliveryRateDto,
  NotificationStatsQueryDto,
  NotificationStatsResponseDto,
} from './dto';

interface DailyRateRow {
  date: Date | string;
  tokens_sent: number;
  tokens_failed: number;
}

@Injectable()
export class AdminNotificationsService {
  constructor(private readonly prisma: PrismaService) {}

  async getStats(
    query: NotificationStatsQueryDto,
  ): Promise<NotificationStatsResponseDto> {
    const days = query.days ?? 30;
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

    const [activeTokens, inactiveTokens30d, rawRows] = await Promise.all([
      // 1. Count currently active FCM tokens
      this.prisma.user_fcm_tokens.count({
        where: { active: true },
      }),

      // 2. Count inactive tokens last used within 30 days
      this.prisma.user_fcm_tokens.count({
        where: {
          active: false,
          last_used: { gte: thirtyDaysAgo },
        },
      }),

      // 3. Daily delivery rate from notification_logs
      this.prisma.$queryRaw<DailyRateRow[]>(Prisma.sql`
        SELECT
          date_trunc('day', created_at)::date AS date,
          COALESCE(SUM(tokens_sent), 0)::int   AS tokens_sent,
          COALESCE(SUM(tokens_failed), 0)::int AS tokens_failed
        FROM notification_logs
        WHERE created_at >= ${since}
        GROUP BY 1
        ORDER BY 1 DESC
      `),
    ]);

    const dailyDeliveryRate: DailyDeliveryRateDto[] = rawRows.map((row) => {
      const sent = Number(row.tokens_sent);
      const failed = Number(row.tokens_failed);
      const total = sent + failed;

      return {
        date:
          row.date instanceof Date
            ? row.date.toISOString().slice(0, 10)
            : String(row.date),
        tokens_sent: sent,
        tokens_failed: failed,
        success_rate: total === 0 ? null : sent / total,
      };
    });

    return {
      activeTokens,
      inactiveTokens30d,
      dailyDeliveryRate,
    };
  }
}
