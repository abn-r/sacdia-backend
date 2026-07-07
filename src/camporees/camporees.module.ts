import { Module } from '@nestjs/common';
import { CamporeesController } from './camporees.controller';
import { CamporeeClubRegistrationController } from './camporee-club-registration.controller';
import { CamporeesService } from './camporees.service';
import { CamporeeLateApprovalsService } from './camporee-late-approvals.service';
import { PrismaModule } from '../prisma/prisma.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { AchievementsModule } from '../achievements/achievements.module';
import { ClubRolesGuard } from '../common/guards';

@Module({
  imports: [PrismaModule, NotificationsModule, AchievementsModule],
  controllers: [CamporeesController, CamporeeClubRegistrationController],
  providers: [CamporeesService, CamporeeLateApprovalsService, ClubRolesGuard],
  exports: [CamporeesService, CamporeeLateApprovalsService],
})
export class CamporeesModule {}
