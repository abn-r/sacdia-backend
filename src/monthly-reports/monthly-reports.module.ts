import { Module } from '@nestjs/common';
import { MonthlyReportsController } from './monthly-reports.controller';
import { MonthlyReportsService } from './monthly-reports.service';
import { MonthlyReportsPdfService } from './monthly-reports-pdf.service';
import { MonthlyReportsCronService } from './monthly-reports-cron.service';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [MonthlyReportsController],
  providers: [
    MonthlyReportsService,
    MonthlyReportsPdfService,
    MonthlyReportsCronService,
  ],
  exports: [MonthlyReportsService],
})
export class MonthlyReportsModule {}
