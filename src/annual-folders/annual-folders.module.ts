import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import {
  AnnualFoldersController,
  AnnualFolderTemplatesController,
} from './annual-folders.controller';
import { AnnualFolderBySectionController } from './annual-folder-by-section.controller';
import { AnnualFoldersService } from './annual-folders.service';
import { AwardCategoriesController } from './award-categories.controller';
import { AwardCategoriesService } from './award-categories.service';
import { EvaluationController } from './evaluation.controller';
import { EvaluationService } from './evaluation.service';
import { RankingsController } from './rankings.controller';
import { RankingsService } from './rankings.service';
import { RankingsProcessor, RANKINGS_QUEUE } from './rankings.processor';
import { PrismaModule } from '../prisma/prisma.module';
import { ClubEnrollmentsModule } from '../club-enrollments/club-enrollments.module';
import { CatalogsModule } from '../catalogs/catalogs.module';
import { SystemConfigModule } from '../system-config/system-config.module';
import { isPlaceholderUrl } from '../config/bullmq.config';
// 8.4-A Task 12 — REST module for member ranking endpoints.
// MemberRankingsModule is the single source of truth for member calc services
// (ClassScoreService, InvestitureScoreService, CamporeeScoreService,
//  EnrollmentClubResolverService, EnrollmentWeightsResolverService,
//  MemberCompositeScoreService).
import { MemberRankingsModule } from '../rankings/member-rankings/member-rankings.module';
// 8.4-A Task 13 — REST module for section ranking endpoints.
// SectionRankingsModule owns SectionAggregationService (Q1.b ownership move).
// Import here so RankingsService can inject SectionAggregationService.
import { SectionRankingsModule } from '../rankings/section-rankings/section-rankings.module';
// 8.4-A Task 14 — Admin CRUD module for enrollment_ranking_weights table.
import { MemberRankingWeightsModule } from '../rankings/member-ranking-weights/member-ranking-weights.module';

function isRedisConfigured(): boolean {
  const rawUrl = process.env.REDIS_URL?.trim();
  if (!rawUrl || isPlaceholderUrl(rawUrl)) return false;
  try {
    new URL(rawUrl);
    return true;
  } catch {
    return false;
  }
}

const redisAvailable = isRedisConfigured();

@Module({
  imports: [
    PrismaModule,
    ClubEnrollmentsModule,
    CatalogsModule,
    SystemConfigModule, // provides SystemConfigService for kill-switches
    MemberRankingsModule, // Task 12 — REST endpoints for member rankings
    SectionRankingsModule, // Task 13 — REST endpoints for section rankings + SectionAggregationService owner
    MemberRankingWeightsModule, // Task 14 — Admin CRUD for enrollment_ranking_weights
    ...(redisAvailable
      ? [BullModule.registerQueue({ name: RANKINGS_QUEUE })]
      : []),
  ],
  controllers: [
    AnnualFolderTemplatesController,
    AnnualFoldersController,
    AnnualFolderBySectionController,
    AwardCategoriesController,
    EvaluationController,
    RankingsController,
  ],
  providers: [
    AnnualFoldersService,
    AwardCategoriesService,
    EvaluationService,
    RankingsService,
    // Calc services (ClassScoreService etc.) are provided by MemberRankingsModule
    // (imported above) and available here via its exports — no re-declaration needed.
    ...(redisAvailable ? [RankingsProcessor] : []),
  ],
  exports: [
    AnnualFoldersService,
    AwardCategoriesService,
    EvaluationService,
    RankingsService,
  ],
})
export class AnnualFoldersModule {}
