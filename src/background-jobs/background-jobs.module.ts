import { Module } from '@nestjs/common';
import { BackgroundJobsQueueModule } from './background-jobs-queue.module';
import { BackgroundJobsProcessor } from './background-jobs.processor';
import { MonthlyReportsModule } from '../monthly-reports/monthly-reports.module';
import { FinancesModule } from '../finances/finances.module';
import { AnnualFoldersModule } from '../annual-folders/annual-folders.module';
import { DataExportModule } from '../data-export/data-export.module';
import { PrismaModule } from '../prisma/prisma.module';
import { CommonModule } from '../common/common.module';
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
    BackgroundJobsQueueModule,
    MonthlyReportsModule,
    FinancesModule,
    AnnualFoldersModule,
    DataExportModule,
  ],
  providers: [...(redisAvailable ? [BackgroundJobsProcessor] : [])],
})
export class BackgroundJobsModule {}
