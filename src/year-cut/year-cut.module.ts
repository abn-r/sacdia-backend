import { Module } from '@nestjs/common';
import { YearCutService } from './year-cut.service';
import { YearCutCronService } from './year-cut-cron.service';
import { PrismaModule } from '../prisma/prisma.module';
import { CommonModule } from '../common/common.module';
import { AnnualMembershipModule } from '../annual-membership/annual-membership.module';

/**
 * YearCutModule — Ecclesiastical year transition for club role assignments.
 *
 * Provides:
 *  - YearCutService: core applyCut() logic
 *  - YearCutCronService: daily @Cron('5 6 * * *') trigger + OnModuleInit recovery
 *
 * NOT the same as YearEndModule (closeYear) — see docs/features/cron-automation.md
 * for the distinction. AnnualMembershipModule is imported for policy only;
 * it must not import YearCutModule.
 */
@Module({
  imports: [PrismaModule, CommonModule, AnnualMembershipModule],
  providers: [YearCutService, YearCutCronService],
  exports: [YearCutService],
})
export class YearCutModule {}
