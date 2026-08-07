import { Module } from '@nestjs/common';
import { MonthlyReportsController } from './monthly-reports.controller';
import { MonthlyReportsService } from './monthly-reports.service';
import { MonthlyReportsPdfService } from './monthly-reports-pdf.service';
import { MonthlyReportArtifactsService } from './monthly-report-artifacts.service';
import { MonthlyReportsCronService } from './monthly-reports-cron.service';
import { MonthlyReportsReminderCronService } from './monthly-reports-reminder-cron.service';
import { PrismaModule } from '../prisma/prisma.module';
import { BackgroundJobsQueueModule } from '../background-jobs/background-jobs-queue.module';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [PrismaModule, BackgroundJobsQueueModule, NotificationsModule],
  controllers: [MonthlyReportsController],
  providers: [
    MonthlyReportsService,
    MonthlyReportsPdfService,
    MonthlyReportArtifactsService,
    MonthlyReportsCronService,
    MonthlyReportsReminderCronService,
  ],
  exports: [MonthlyReportsService, MonthlyReportArtifactsService],
})
export class MonthlyReportsModule {}
