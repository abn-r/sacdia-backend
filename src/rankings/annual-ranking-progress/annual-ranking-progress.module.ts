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
  ],
  exports: [
    AnnualRankingProgressService,
    AnnualRankingsService,
    AnnualRankingConfigService,
    RankingTiersService,
  ],
})
export class AnnualRankingProgressModule {}
