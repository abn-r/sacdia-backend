import { Module } from '@nestjs/common';
import { AnnualRankingProgressController } from './annual-ranking-progress.controller';
import { AnnualRankingProgressService } from './annual-ranking-progress.service';
import { AnnualRankingConfigService } from './annual-ranking-config.service';
import { RankingTierCalculatorService } from './services/ranking-tier-calculator.service';

/**
 * Section-scoped annual ranking progress endpoints.
 *
 * Mobile consumes this module as a non-competitive scorecard: current points,
 * recognition tier, component progress, and pending annual-folder items for
 * the caller's own section.
 */
@Module({
  controllers: [AnnualRankingProgressController],
  providers: [
    AnnualRankingProgressService,
    AnnualRankingConfigService,
    RankingTierCalculatorService,
  ],
  exports: [AnnualRankingProgressService, AnnualRankingConfigService],
})
export class AnnualRankingProgressModule {}
