import { Module, forwardRef } from '@nestjs/common';
import { MemberRankingsController } from './member-rankings.controller';
import { MemberRankingsService } from './member-rankings.service';
import { ClassScoreService } from './services/class-score.service';
import { InvestitureScoreService } from './services/investiture-score.service';
import { CamporeeScoreService } from './services/camporee-score.service';
import { EnrollmentClubResolverService } from './services/enrollment-club-resolver.service';
import { EnrollmentWeightsResolverService } from './services/enrollment-weights-resolver.service';
import { MemberCompositeScoreService } from './services/member-composite-score.service';
import { SectionAggregationService } from '../section-rankings/services/section-aggregation.service';
import { SystemConfigModule } from '../../system-config/system-config.module';
import { AnnualFoldersModule } from '../../annual-folders/annual-folders.module';

/**
 * Standalone REST module for member-level ranking endpoints.
 *
 * Wiring strategy:
 *   - Calculation services (ClassScoreService, InvestitureScoreService,
 *     CamporeeScoreService, EnrollmentClubResolverService,
 *     EnrollmentWeightsResolverService, MemberCompositeScoreService,
 *     SectionAggregationService) are the single source of truth — all
 *     declared and exported here. AnnualFoldersModule must NOT re-declare them.
 *   - RankingsService (owned by AnnualFoldersModule) is needed for
 *     triggerRecalculate — imported via forwardRef to guard against circular
 *     dependency at Nest module resolution time.
 *   - PrismaModule is @Global so PrismaService is available without an
 *     explicit import.
 *
 * This module is imported from AnnualFoldersModule.imports[] (Task 12 Q2.a).
 */
@Module({
  imports: [
    SystemConfigModule,
    forwardRef(() => AnnualFoldersModule),
  ],
  controllers: [MemberRankingsController],
  providers: [
    MemberRankingsService,
    ClassScoreService,
    InvestitureScoreService,
    CamporeeScoreService,
    EnrollmentClubResolverService,
    EnrollmentWeightsResolverService,
    MemberCompositeScoreService,
    SectionAggregationService,
  ],
  exports: [
    MemberRankingsService,
    ClassScoreService,
    InvestitureScoreService,
    CamporeeScoreService,
    EnrollmentClubResolverService,
    EnrollmentWeightsResolverService,
    MemberCompositeScoreService,
    SectionAggregationService,
  ],
})
export class MemberRankingsModule {}
