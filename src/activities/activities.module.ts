import { Module } from '@nestjs/common';
import { ActivitiesController } from './activities.controller';
import { ActivitiesService } from './activities.service';
import { ActivitiesReminderService } from './activities-reminder.service';
import { PrismaModule } from '../prisma/prisma.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { ClubRolesGuard } from '../common/guards';

@Module({
  imports: [PrismaModule, NotificationsModule],
  controllers: [ActivitiesController],
  providers: [ActivitiesService, ActivitiesReminderService, ClubRolesGuard],
  exports: [ActivitiesService],
})
export class ActivitiesModule {}
