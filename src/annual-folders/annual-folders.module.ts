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
// 8.4-A — member + section ranking calculation pipeline
import { ClassScoreService } from '../rankings/member-rankings/services/class-score.service';
import { InvestitureScoreService } from '../rankings/member-rankings/services/investiture-score.service';
import { CamporeeScoreService } from '../rankings/member-rankings/services/camporee-score.service';
import { EnrollmentClubResolverService } from '../rankings/member-rankings/services/enrollment-club-resolver.service';
import { EnrollmentWeightsResolverService } from '../rankings/member-rankings/services/enrollment-weights-resolver.service';
import { MemberCompositeScoreService } from '../rankings/member-rankings/services/member-composite-score.service';
import { SectionAggregationService } from '../rankings/section-rankings/services/section-aggregation.service';

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
    // 8.4-A new — calculation pipeline (standalone @Injectable services)
    ClassScoreService,
    InvestitureScoreService,
    CamporeeScoreService,
    EnrollmentClubResolverService,
    EnrollmentWeightsResolverService,
    MemberCompositeScoreService,
    SectionAggregationService,
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
