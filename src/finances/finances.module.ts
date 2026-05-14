import { Module } from '@nestjs/common';
import { FinancesController } from './finances.controller';
import { FinancesService } from './finances.service';
import { FinancePeriodService } from './finance-period.service';
import { PrismaModule } from '../prisma/prisma.module';
import { ClubRolesGuard } from '../common/guards';
import { BackgroundJobsQueueModule } from '../background-jobs/background-jobs-queue.module';

@Module({
  imports: [PrismaModule, BackgroundJobsQueueModule],
  controllers: [FinancesController],
  providers: [FinancesService, FinancePeriodService, ClubRolesGuard],
  exports: [FinancesService, FinancePeriodService],
})
export class FinancesModule {}
