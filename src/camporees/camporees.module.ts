import { Module } from '@nestjs/common';
import { CamporeesController } from './camporees.controller';
import { CamporeeClubRegistrationController } from './camporee-club-registration.controller';
import { CamporeesService } from './camporees.service';
import { CamporeeLateApprovalsService } from './camporee-late-approvals.service';
import { PrismaModule } from '../prisma/prisma.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { AchievementsModule } from '../achievements/achievements.module';
import { FieldPaymentOrdersModule } from '../field-payment-orders/field-payment-orders.module';
import { ClubRolesGuard } from '../common/guards';
import { CamporeeLifecyclePolicy } from './policies';

@Module({
  imports: [
    PrismaModule,
    NotificationsModule,
    AchievementsModule,
    FieldPaymentOrdersModule,
  ],
  controllers: [CamporeesController, CamporeeClubRegistrationController],
  providers: [
    CamporeesService,
    CamporeeLateApprovalsService,
    CamporeeLifecyclePolicy,
    ClubRolesGuard,
  ],
  exports: [CamporeesService, CamporeeLateApprovalsService],
})
export class CamporeesModule {}
