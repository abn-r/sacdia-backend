import { Module } from '@nestjs/common';
import { MonthlyReportsController } from './monthly-reports.controller';
import { MonthlyReportsService } from './monthly-reports.service';
import { MonthlyReportsPdfService } from './monthly-reports-pdf.service';
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
    MonthlyReportsCronService,
    MonthlyReportsReminderCronService,
  ],
  exports: [MonthlyReportsService],
})
export class MonthlyReportsModule {}
