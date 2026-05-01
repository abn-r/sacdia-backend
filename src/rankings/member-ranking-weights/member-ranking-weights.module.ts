import { Module } from '@nestjs/common';
import { MemberRankingWeightsController } from './member-ranking-weights.controller';
import { MemberRankingWeightsService } from './member-ranking-weights.service';

/**
 * Admin CRUD module for `enrollment_ranking_weights`.
 *
 * PrismaModule is @Global — no explicit import needed (verified via member-rankings.module).
 *
 * Imported by AnnualFoldersModule (Task 14 Q1) so the controller is
 * registered under the global API prefix via that module's host application.
 */
@Module({
  controllers: [MemberRankingWeightsController],
  providers: [MemberRankingWeightsService],
  exports: [MemberRankingWeightsService],
})
export class MemberRankingWeightsModule {}
