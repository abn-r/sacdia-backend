import { Module } from '@nestjs/common';
import { MonthlyReportsController } from './monthly-reports.controller';
import { MonthlyReportsService } from './monthly-reports.service';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [MonthlyReportsController],
  providers: [MonthlyReportsService],
  exports: [MonthlyReportsService],
})
export class MonthlyReportsModule {}
