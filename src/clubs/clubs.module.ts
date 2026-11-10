import { Module } from '@nestjs/common';
import { ClubsController, ClubRolesController } from './clubs.controller';
import { ClubsService } from './clubs.service';
import { ClubRoleEligibilityModule } from '../club-role-eligibility/club-role-eligibility.module';
import { DirectorDesignationService } from './director-designation.service';
import { ClubRoleCandidatesService } from './club-role-candidates.service';
import { ConsentGateService } from '../membership-requests/consent-gate.service';
import { PrismaModule } from '../prisma/prisma.module';
import { ClubRolesGuard } from '../common/guards';
import { NotificationsModule } from '../notifications/notifications.module';
import { RoleRequirementsModule } from '../role-requirements/role-requirements.module';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';

@Module({
  imports: [
    PrismaModule,
    NotificationsModule,
    AuditLogsModule,
    ClubRoleEligibilityModule,
    RoleRequirementsModule,
  ],
  controllers: [ClubsController, ClubRolesController],
  providers: [
    ClubsService,
    ClubRolesGuard,
    DirectorDesignationService,
    ClubRoleCandidatesService,
    ConsentGateService,
  ],
  exports: [ClubsService, DirectorDesignationService],
})
export class ClubsModule {}
