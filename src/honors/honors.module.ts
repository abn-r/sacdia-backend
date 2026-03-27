import { Module } from '@nestjs/common';
import { HonorsController, UserHonorsController } from './honors.controller';
import {
  HonorRequirementsController,
  UserHonorRequirementsController,
} from './honor-requirements.controller';
import { HonorsService } from './honors.service';
import { HonorRequirementsService } from './honor-requirements.service';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [
    HonorsController,
    UserHonorsController,
    HonorRequirementsController,
    UserHonorRequirementsController,
  ],
  providers: [HonorsService, HonorRequirementsService],
  exports: [HonorsService],
})
export class HonorsModule {}
