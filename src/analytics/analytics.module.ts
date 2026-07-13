import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { PrismaModule } from '../prisma/prisma.module';
import { CommonModule } from '../common/common.module';
import { CoordinationModule } from '../coordination/coordination.module';
import { AnalyticsController } from './analytics.controller';
import { AnalyticsService } from './analytics.service';
import { LocalFieldDashboardService } from './local-field-dashboard.service';
import { JobsOverviewService } from './jobs-overview.service';
import { CronRunsService } from './cron-runs.service';
import { NOTIFICATIONS_QUEUE } from '../notifications/notifications.processor';
import { ACHIEVEMENTS_QUEUE } from '../achievements/achievements.constants';
import { EMAIL_QUEUE } from '../common/email/email.queue';
import { BACKGROUND_JOBS_QUEUE } from '../background-jobs/background-jobs.types';
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
    CoordinationModule,
    ...(redisAvailable
      ? [
          BullModule.registerQueue(
            { name: NOTIFICATIONS_QUEUE },
            { name: ACHIEVEMENTS_QUEUE },
            { name: EMAIL_QUEUE },
            { name: BACKGROUND_JOBS_QUEUE },
          ),
        ]
      : []),
  ],
  controllers: [AnalyticsController],
  providers: [
    AnalyticsService,
    LocalFieldDashboardService,
    CronRunsService,
    ...(redisAvailable ? [JobsOverviewService] : []),
  ],
})
export class AnalyticsModule {}
