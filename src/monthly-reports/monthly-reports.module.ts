import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { MonthlyReportsController } from './monthly-reports.controller';
import { MonthlyReportsService } from './monthly-reports.service';
import { MonthlyReportsPdfService } from './monthly-reports-pdf.service';
import { MonthlyReportsCronService } from './monthly-reports-cron.service';
import {
  MonthlyReportsProcessor,
  MONTHLY_REPORTS_QUEUE,
} from './monthly-reports.processor';
import { PrismaModule } from '../prisma/prisma.module';
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
    ...(redisAvailable
      ? [BullModule.registerQueue({ name: MONTHLY_REPORTS_QUEUE })]
      : []),
  ],
  controllers: [MonthlyReportsController],
  providers: [
    MonthlyReportsService,
    MonthlyReportsPdfService,
    MonthlyReportsCronService,
    ...(redisAvailable ? [MonthlyReportsProcessor] : []),
  ],
  exports: [MonthlyReportsService],
})
export class MonthlyReportsModule {}
