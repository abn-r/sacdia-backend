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
import { isPlaceholderUrl } from '../config/bullmq.config';

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
