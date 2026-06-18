import { Module } from '@nestjs/common';
import { CommonModule } from '../common/common.module';
import { PrismaModule } from '../prisma/prisma.module';
import {
  AdminCoordinationController,
  CoordinationController,
} from './coordination.controller';
import { CoordinationService } from './coordination.service';

@Module({
  imports: [CommonModule, PrismaModule],
  controllers: [AdminCoordinationController, CoordinationController],
  providers: [CoordinationService],
  exports: [CoordinationService],
})
export class CoordinationModule {}
