import { Module } from '@nestjs/common';
import { ClubsController, ClubRolesController } from './clubs.controller';
import { ClubsService } from './clubs.service';
import { ClubRoleEligibilityModule } from '../club-role-eligibility/club-role-eligibility.module';
import { DirectorDesignationService } from './director-designation.service';
import { PrismaModule } from '../prisma/prisma.module';
import { ClubRolesGuard } from '../common/guards';
import { NotificationsModule } from '../notifications/notifications.module';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';

@Module({
  imports: [
    PrismaModule,
    NotificationsModule,
    AuditLogsModule,
    ClubRoleEligibilityModule,
  ],
  controllers: [ClubsController, ClubRolesController],
  providers: [ClubsService, ClubRolesGuard, DirectorDesignationService],
  exports: [ClubsService, DirectorDesignationService],
})
export class ClubsModule {}
