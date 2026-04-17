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

@Module({
  imports: [PrismaModule, AchievementsModule],
  controllers: [
    HonorsController,
    UserHonorsController,
    HonorRequirementsController,
    UserHonorRequirementsController,
    AdminHonorsController,
  ],
  providers: [HonorsService, HonorRequirementsService, AdminHonorsService],
  exports: [HonorsService],
})
export class HonorsModule {}
