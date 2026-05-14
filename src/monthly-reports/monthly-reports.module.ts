import { Module } from '@nestjs/common';
import { MonthlyReportsController } from './monthly-reports.controller';
import { MonthlyReportsService } from './monthly-reports.service';
import { MonthlyReportsPdfService } from './monthly-reports-pdf.service';
import { MonthlyReportsCronService } from './monthly-reports-cron.service';
import { PrismaModule } from '../prisma/prisma.module';
import { BackgroundJobsQueueModule } from '../background-jobs/background-jobs-queue.module';

@Module({
  imports: [PrismaModule, BackgroundJobsQueueModule],
  controllers: [MonthlyReportsController],
  providers: [
    MonthlyReportsService,
    MonthlyReportsPdfService,
    MonthlyReportsCronService,
  ],
  exports: [MonthlyReportsService],
})
export class MonthlyReportsModule {}
