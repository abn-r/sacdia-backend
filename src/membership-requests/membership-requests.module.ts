import { Module } from '@nestjs/common';
import { MembershipRequestsController } from './membership-requests.controller';
import { MembershipRequestsService } from './membership-requests.service';
import { MembershipRequestsCronService } from './membership-requests-cron.service';
import { PrismaModule } from '../prisma/prisma.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { ClubRoleEligibilityModule } from '../club-role-eligibility/club-role-eligibility.module';

@Module({
  imports: [PrismaModule, NotificationsModule, ClubRoleEligibilityModule],
  controllers: [MembershipRequestsController],
  providers: [MembershipRequestsService, MembershipRequestsCronService],
  exports: [MembershipRequestsService],
})
export class MembershipRequestsModule {}
