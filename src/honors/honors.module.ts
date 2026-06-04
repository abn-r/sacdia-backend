import { Module } from '@nestjs/common';
import { HonorsController, UserHonorsController } from './honors.controller';
import {
  HonorRequirementsController,
  UserHonorRequirementsController,
} from './honor-requirements.controller';
import { HonorsService } from './honors.service';
import { HonorRequirementsService } from './honor-requirements.service';
import { AdminHonorsController } from '../admin/admin-honors.controller';
import { AdminHonorsService } from '../admin/admin-honors.service';
import { PrismaModule } from '../prisma/prisma.module';
import { AchievementsModule } from '../achievements/achievements.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { HonorValidationWorkflowService } from './honor-validation-workflow.service';
import { MasterHonorsEvaluatorService } from './master-honors-evaluator.service';

@Module({
  imports: [PrismaModule, AchievementsModule, NotificationsModule],
  controllers: [
    HonorsController,
    UserHonorsController,
    HonorRequirementsController,
    UserHonorRequirementsController,
    AdminHonorsController,
  ],
  providers: [
    HonorsService,
    HonorRequirementsService,
    AdminHonorsService,
    HonorValidationWorkflowService,
    MasterHonorsEvaluatorService,
  ],
  exports: [HonorsService, HonorValidationWorkflowService],
})
export class HonorsModule {}
