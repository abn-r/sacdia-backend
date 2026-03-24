import { Module } from '@nestjs/common';
import { YearEndController } from './year-end.controller';
import { YearEndService } from './year-end.service';
import { PrismaModule } from '../prisma/prisma.module';
import { MonthlyReportsModule } from '../monthly-reports/monthly-reports.module';

@Module({
  imports: [PrismaModule, MonthlyReportsModule],
  controllers: [YearEndController],
  providers: [YearEndService],
  exports: [YearEndService],
})
export class YearEndModule {}
