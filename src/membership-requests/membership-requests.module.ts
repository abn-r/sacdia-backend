import { Module } from '@nestjs/common';
import { MembershipRequestsController } from './membership-requests.controller';
import { MembershipRequestsService } from './membership-requests.service';
import { MembershipRequestsCronService } from './membership-requests-cron.service';
import { PrismaModule } from '../prisma/prisma.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { ClubRoleEligibilityModule } from '../club-role-eligibility/club-role-eligibility.module';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { ConsentGateService } from './consent-gate.service';
import { ConsentVerificationService } from './consent-verification.service';
import { ActingForModule } from '../auth/acting-for/acting-for.module';
import { GuardianshipsModule } from '../guardianships/guardianships.module';

@Module({
  imports: [
    PrismaModule,
    NotificationsModule,
    ClubRoleEligibilityModule,
    GuardianshipsModule,
    ActingForModule,
  ],
  controllers: [MembershipRequestsController],
  providers: [
    MembershipRequestsService,
    MembershipRequestsCronService,
    ConsentGateService,
    ConsentVerificationService,
    AuditLogsService,
  ],
  exports: [MembershipRequestsService, ConsentGateService],
})
export class MembershipRequestsModule {}
