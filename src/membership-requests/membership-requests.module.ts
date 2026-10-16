import { Module } from '@nestjs/common';
import { MembershipRequestsController } from './membership-requests.controller';
import { MembershipRequestsService } from './membership-requests.service';
import { MembershipRequestsCronService } from './membership-requests-cron.service';
import { PrismaModule } from '../prisma/prisma.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { ClubRoleEligibilityModule } from '../club-role-eligibility/club-role-eligibility.module';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { ConsentGateService } from './consent-gate.service';

@Module({
  imports: [PrismaModule, NotificationsModule, ClubRoleEligibilityModule],
  controllers: [MembershipRequestsController],
  providers: [
    MembershipRequestsService,
    MembershipRequestsCronService,
    ConsentGateService,
    AuditLogsService,
  ],
  exports: [MembershipRequestsService, ConsentGateService],
})
export class MembershipRequestsModule {}
