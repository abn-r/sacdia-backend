import { Module } from '@nestjs/common';
import { QuarterlyReportsController } from './quarterly-reports.controller';
import { QuarterlyReportsService } from './quarterly-reports.service';
import { QuarterlyReportsPdfService } from './quarterly-reports-pdf.service';
import { QuarterlyReportsCronService } from './quarterly-reports-cron.service';
import { PrismaModule } from '../prisma/prisma.module';
import { CommonModule } from '../common/common.module';

@Module({
  imports: [PrismaModule, CommonModule],
  controllers: [QuarterlyReportsController],
  providers: [
    QuarterlyReportsService,
    QuarterlyReportsPdfService,
    QuarterlyReportsCronService,
  ],
  exports: [QuarterlyReportsService],
})
export class QuarterlyReportsModule {}
