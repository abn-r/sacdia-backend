import { Module } from '@nestjs/common';
import { FinancesController } from './finances.controller';
import { FinancesService } from './finances.service';
import { FinancePeriodService } from './finance-period.service';
import { FinanceReminderService } from './finance-reminder.service';
import { FinanceReportsService } from './finance-reports.service';
import { FinanceAggregationModule } from './finance-aggregation.module';
import { FinanceScoreService } from '../annual-folders/score-calculators/finance-score';
import { NotificationsModule } from '../notifications/notifications.module';
import { PrismaModule } from '../prisma/prisma.module';
import { CatalogsModule } from '../catalogs/catalogs.module';
import { ClubRolesGuard } from '../common/guards';
import { SectionResponsiblesService } from '../common/authorization/section-responsibles.service';
import { BackgroundJobsQueueModule } from '../background-jobs/background-jobs-queue.module';

@Module({
  imports: [
    PrismaModule,
    CatalogsModule,
    BackgroundJobsQueueModule,
    FinanceAggregationModule,
    NotificationsModule,
  ],
  controllers: [FinancesController],
  providers: [
    FinancesService,
    FinancePeriodService,
    FinanceReportsService,
    FinanceReminderService,
    FinanceScoreService,
    SectionResponsiblesService,
    ClubRolesGuard,
  ],
  exports: [FinancesService, FinancePeriodService, FinanceReminderService],
})
export class FinancesModule {}
