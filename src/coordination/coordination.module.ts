import { Module } from '@nestjs/common';
import { CommonModule } from '../common/common.module';
import { PrismaModule } from '../prisma/prisma.module';
import { ActorSectionScopeService } from './actor-section-scope.service';
import {
  AdminCoordinationController,
  CoordinationController,
} from './coordination.controller';
import { CoordinationService } from './coordination.service';

@Module({
  imports: [CommonModule, PrismaModule],
  controllers: [AdminCoordinationController, CoordinationController],
  providers: [CoordinationService, ActorSectionScopeService],
  exports: [CoordinationService, ActorSectionScopeService],
})
export class CoordinationModule {}
