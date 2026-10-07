import { Module } from '@nestjs/common';
import { RequestsController } from './requests.controller';
import { RequestsService } from './requests.service';
import { PrismaModule } from '../prisma/prisma.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { ClubRoleEligibilityModule } from '../club-role-eligibility/club-role-eligibility.module';

@Module({
  imports: [PrismaModule, NotificationsModule, ClubRoleEligibilityModule],
  controllers: [RequestsController],
  providers: [RequestsService],
  exports: [RequestsService],
})
export class RequestsModule {}
