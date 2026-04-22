import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { PrismaModule } from '../prisma/prisma.module';
import { CommonModule } from '../common/common.module';
import { AnalyticsController } from './analytics.controller';
import { AnalyticsService } from './analytics.service';
import { JobsOverviewService } from './jobs-overview.service';
import { CronRunsService } from './cron-runs.service';
import { NOTIFICATIONS_QUEUE } from '../notifications/notifications.processor';
import { ACHIEVEMENTS_QUEUE } from '../achievements/achievements.constants';
import { DATA_EXPORTS_QUEUE } from '../data-export/data-export.processor';
import { isPlaceholderUrl } from '../config/bullmq.config';

function isRedisConfigured(): boolean {
  const rawUrl = process.env.REDIS_URL?.trim();
  if (!rawUrl || isPlaceholderUrl(rawUrl)) return false;
  try {
    new URL(rawUrl);
    return true;
  } catch {
    return false;
  }
}

const redisAvailable = isRedisConfigured();

@Module({
  imports: [
    PrismaModule,
    CommonModule,
    ...(redisAvailable
      ? [
          BullModule.registerQueue(
            { name: NOTIFICATIONS_QUEUE },
            { name: ACHIEVEMENTS_QUEUE },
            { name: DATA_EXPORTS_QUEUE },
          ),
        ]
      : []),
  ],
  controllers: [AnalyticsController],
  providers: [
    AnalyticsService,
    CronRunsService,
    ...(redisAvailable ? [JobsOverviewService] : []),
  ],
})
export class AnalyticsModule {}
