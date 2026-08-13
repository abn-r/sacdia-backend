import { Module } from '@nestjs/common';
import { AnnualReportsController } from './annual-reports.controller';
import { AnnualReportsService } from './annual-reports.service';
import { AnnualReportsPdfService } from './annual-reports-pdf.service';
import { AnnualReportsCronService } from './annual-reports-cron.service';
import { PrismaModule } from '../prisma/prisma.module';
import { CommonModule } from '../common/common.module';
import { CoordinationModule } from '../coordination/coordination.module';

@Module({
  imports: [PrismaModule, CommonModule, CoordinationModule],
  controllers: [AnnualReportsController],
  providers: [
    AnnualReportsService,
    AnnualReportsPdfService,
    AnnualReportsCronService,
  ],
  exports: [AnnualReportsService],
})
export class AnnualReportsModule {}
