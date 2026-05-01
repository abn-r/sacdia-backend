import { Module, forwardRef } from '@nestjs/common';
import { MemberRankingsController } from './member-rankings.controller';
import { MemberRankingsService } from './member-rankings.service';
import { ClassScoreService } from './services/class-score.service';
import { InvestitureScoreService } from './services/investiture-score.service';
import { CamporeeScoreService } from './services/camporee-score.service';
import { EnrollmentClubResolverService } from './services/enrollment-club-resolver.service';
import { EnrollmentWeightsResolverService } from './services/enrollment-weights-resolver.service';
import { MemberCompositeScoreService } from './services/member-composite-score.service';
import { SystemConfigModule } from '../../system-config/system-config.module';
import { AnnualFoldersModule } from '../../annual-folders/annual-folders.module';

/**
 * Standalone REST module for member-level ranking endpoints.
 *
 * Wiring strategy:
 *   - Calculation services (ClassScoreService, InvestitureScoreService,
 *     CamporeeScoreService, EnrollmentClubResolverService,
 *     EnrollmentWeightsResolverService, MemberCompositeScoreService)
 *     are the single source of truth — all declared and exported here.
 *   - SectionAggregationService ownership MOVED to SectionRankingsModule
 *     (Task 13 Q1.b) — its semantic home. AnnualFoldersModule now imports
 *     SectionRankingsModule directly to get SectionAggregationService.
 *   - RankingsService (owned by AnnualFoldersModule) is needed for
 *     triggerRecalculate — imported via forwardRef to guard against circular
 *     dependency at Nest module resolution time.
 *   - PrismaModule is @Global so PrismaService is available without an
 *     explicit import.
 *
 * This module is imported from AnnualFoldersModule.imports[] (Task 12 Q2.a).
 */
@Module({
  imports: [SystemConfigModule, forwardRef(() => AnnualFoldersModule)],
  controllers: [MemberRankingsController],
  providers: [
    MemberRankingsService,
    ClassScoreService,
    InvestitureScoreService,
    CamporeeScoreService,
    EnrollmentClubResolverService,
    EnrollmentWeightsResolverService,
    MemberCompositeScoreService,
  ],
  exports: [
    MemberRankingsService,
    ClassScoreService,
    InvestitureScoreService,
    CamporeeScoreService,
    EnrollmentClubResolverService,
    EnrollmentWeightsResolverService,
    MemberCompositeScoreService,
  ],
})
export class MemberRankingsModule {}
