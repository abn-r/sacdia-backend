import { Module } from '@nestjs/common';
import { CommonModule } from '../common/common.module';
import { MembershipRequestsModule } from '../membership-requests/membership-requests.module';
import { PrismaModule } from '../prisma/prisma.module';
import { ActorSectionScopeService } from './actor-section-scope.service';
import {
  AdminCoordinationController,
  CoordinationController,
} from './coordination.controller';
import { CoordinationService } from './coordination.service';
import { CoordinatorConsentQueueService } from './coordinator-consent-queue.service';

@Module({
  imports: [CommonModule, PrismaModule, MembershipRequestsModule],
  controllers: [AdminCoordinationController, CoordinationController],
  providers: [
    CoordinationService,
    ActorSectionScopeService,
    CoordinatorConsentQueueService,
  ],
  exports: [CoordinationService, ActorSectionScopeService],
})
export class CoordinationModule {}
