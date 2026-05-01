import { Module } from '@nestjs/common';
import { SectionRankingsController } from './section-rankings.controller';
import { SectionRankingsService } from './section-rankings.service';
import { SectionAggregationService } from './services/section-aggregation.service';

/**
 * REST module for section-level ranking endpoints.
 *
 * Ownership note (Q1.b — Task 13):
 *   SectionAggregationService is owned here — it was previously provided and
 *   exported from MemberRankingsModule (Task 12 dedup). Moving it here gives
 *   it the correct semantic home. AnnualFoldersModule must import
 *   SectionRankingsModule (not MemberRankingsModule) to get SectionAggregationService
 *   for use in RankingsService.recalculateSectionAggregates.
 *
 * PrismaModule is @Global so PrismaService is available without an explicit import.
 */
@Module({
  imports: [],
  controllers: [SectionRankingsController],
  providers: [SectionRankingsService, SectionAggregationService],
  exports: [SectionRankingsService, SectionAggregationService],
})
export class SectionRankingsModule {}
