import { Module } from '@nestjs/common';
import { ClubsController, ClubRolesController } from './clubs.controller';
import { ClubsService } from './clubs.service';
import { ClubRoleEligibilityService } from './club-role-eligibility.service';
import { PrismaModule } from '../prisma/prisma.module';
import { ClubRolesGuard } from '../common/guards';
import { NotificationsModule } from '../notifications/notifications.module';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';

@Module({
  imports: [PrismaModule, NotificationsModule, AuditLogsModule],
  controllers: [ClubsController, ClubRolesController],
  providers: [ClubsService, ClubRoleEligibilityService, ClubRolesGuard],
  exports: [ClubsService, ClubRoleEligibilityService],
})
export class ClubsModule {}
