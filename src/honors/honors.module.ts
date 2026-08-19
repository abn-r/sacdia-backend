import { Module } from '@nestjs/common';
import { HonorsController, UserHonorsController } from './honors.controller';
import { UserMasterHonorsController } from './master-honors.controller';
import {
  HonorRequirementsController,
  UserHonorRequirementsController,
} from './honor-requirements.controller';
import { HonorsService } from './honors.service';
import { HonorRequirementsService } from './honor-requirements.service';
import { AdminHonorsController } from '../admin/admin-honors.controller';
import { AdminHonorsService } from '../admin/admin-honors.service';
import { PrismaModule } from '../prisma/prisma.module';
import { CatalogsModule } from '../catalogs/catalogs.module';
import { AchievementsModule } from '../achievements/achievements.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { HonorValidationWorkflowService } from './honor-validation-workflow.service';
import { MasterHonorsEvaluatorService } from './master-honors-evaluator.service';
import { MasterHonorsService } from './master-honors.service';
import { MasterHonorsQueueModule } from './master-honors-queue.module';
import { MasterHonorsRecalculationProcessor } from './master-honors-recalculation.processor';
import { isPlaceholderUrl } from '../config/bullmq.config';

function isRedisConfigured(): boolean {
  const rawUrl = process.env.REDIS_URL?.trim();
  if (!rawUrl || isPlaceholderUrl(rawUrl)) {
    return false;
  }

  try {
    new URL(rawUrl);
    return true;
  } catch {
    return false;
  }
}

@Module({
  imports: [
    PrismaModule,
    CatalogsModule,
    AchievementsModule,
    NotificationsModule,
    MasterHonorsQueueModule,
  ],
  controllers: [
    HonorsController,
    UserHonorsController,
    UserMasterHonorsController,
    HonorRequirementsController,
    UserHonorRequirementsController,
    AdminHonorsController,
  ],
  providers: [
    HonorsService,
    HonorRequirementsService,
    MasterHonorsService,
    AdminHonorsService,
    HonorValidationWorkflowService,
    MasterHonorsEvaluatorService,
    ...(isRedisConfigured() ? [MasterHonorsRecalculationProcessor] : []),
  ],
  exports: [HonorsService, HonorValidationWorkflowService],
})
export class HonorsModule {}
