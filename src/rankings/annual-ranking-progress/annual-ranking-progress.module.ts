import { Module } from '@nestjs/common';
import { AnnualRankingsController } from './annual-rankings.controller';
import { AnnualRankingsService } from './annual-rankings.service';
import { AnnualRankingProgressController } from './annual-ranking-progress.controller';
import { AnnualRankingProgressService } from './annual-ranking-progress.service';
import { AnnualRankingConfigController } from './annual-ranking-config.controller';
import { AnnualRankingConfigService } from './annual-ranking-config.service';
import { RankingTiersController } from './ranking-tiers.controller';
import { RankingTiersService } from './ranking-tiers.service';
import { RankingTierCalculatorService } from './services/ranking-tier-calculator.service';
import { AnnualRankingScoreRegistryService } from './services/annual-ranking-score-registry.service';
import { FolderScoreService } from '../../annual-folders/score-calculators/folder-score';
import { FinanceScoreService } from '../../annual-folders/score-calculators/finance-score';
import { CamporeeScoreService } from '../../annual-folders/score-calculators/camporee-score';
import { MonthlyReportsTimelinessScoreService } from '../../annual-folders/score-calculators/monthly-reports-timeliness-score';
import { InstitutionalDataCompletenessScoreService } from '../../annual-folders/score-calculators/institutional-data-completeness-score';
import { ActivitiesRegisteredScoreService } from '../../annual-folders/score-calculators/activities-registered-score';
import { AttendanceParticipationScoreService } from '../../annual-folders/score-calculators/attendance-participation-score';
import { ClassInvestitureProgressScoreService } from '../../annual-folders/score-calculators/class-investiture-progress-score';
import { SacdiaOperationalUsageScoreService } from '../../annual-folders/score-calculators/sacdia-operational-usage-score';

/**
 * Section-scoped annual ranking progress endpoints.
 *
 * Mobile consumes this module as a non-competitive scorecard: current points,
 * recognition tier, component progress, and pending annual-folder items for
 * the caller's own section.
 */
@Module({
  controllers: [
    AnnualRankingProgressController,
    AnnualRankingsController,
    AnnualRankingConfigController,
    RankingTiersController,
  ],
  providers: [
    AnnualRankingProgressService,
    AnnualRankingsService,
    AnnualRankingConfigService,
    RankingTiersService,
    RankingTierCalculatorService,
    AnnualRankingScoreRegistryService,
    FolderScoreService,
    FinanceScoreService,
    CamporeeScoreService,
    MonthlyReportsTimelinessScoreService,
    InstitutionalDataCompletenessScoreService,
    ActivitiesRegisteredScoreService,
    AttendanceParticipationScoreService,
    ClassInvestitureProgressScoreService,
    SacdiaOperationalUsageScoreService,
  ],
  exports: [
    AnnualRankingProgressService,
    AnnualRankingsService,
    AnnualRankingConfigService,
    RankingTiersService,
    AnnualRankingScoreRegistryService,
  ],
})
export class AnnualRankingProgressModule {}
