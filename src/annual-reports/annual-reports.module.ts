import { FinanceAggregationModule } from '../finances/finance-aggregation.module';
import { Module } from '@nestjs/common';
import { AnnualReportsController } from './annual-reports.controller';
import { AnnualReportsService } from './annual-reports.service';
import { AnnualReportsPdfService } from './annual-reports-pdf.service';
import { AnnualReportsCronService } from './annual-reports-cron.service';
import { PrismaModule } from '../prisma/prisma.module';
import { CommonModule } from '../common/common.module';
import { PeriodicReportDataService } from '../reports/periodic-report-data.service';

@Module({
  imports: [PrismaModule, CommonModule, FinanceAggregationModule],
  controllers: [AnnualReportsController],
  providers: [
    PeriodicReportDataService,
    AnnualReportsService,
    AnnualReportsPdfService,
    AnnualReportsCronService,
  ],
  exports: [AnnualReportsService],
})
export class AnnualReportsModule {}
