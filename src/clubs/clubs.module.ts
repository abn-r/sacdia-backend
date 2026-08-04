import { Module } from '@nestjs/common';
import { ClubsController, ClubRolesController } from './clubs.controller';
import { ClubsService } from './clubs.service';
import { DirectorSuccessionPlansService } from './director-succession-plans.service';
import { PrismaModule } from '../prisma/prisma.module';
import { ClubRolesGuard } from '../common/guards';
import { NotificationsModule } from '../notifications/notifications.module';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';

@Module({
  imports: [PrismaModule, NotificationsModule, AuditLogsModule],
  controllers: [ClubsController, ClubRolesController],
  providers: [ClubsService, ClubRolesGuard, DirectorSuccessionPlansService],
  exports: [ClubsService, DirectorSuccessionPlansService],
})
export class ClubsModule {}
