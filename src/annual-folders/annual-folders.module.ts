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
// MemberRankingsModule is the single source of truth for all calc services
// (ClassScoreService, InvestitureScoreService, CamporeeScoreService,
//  EnrollmentClubResolverService, EnrollmentWeightsResolverService,
//  MemberCompositeScoreService, SectionAggregationService).
// They are exported from MemberRankingsModule and available here via import.
import { MemberRankingsModule } from '../rankings/member-rankings/member-rankings.module';

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
