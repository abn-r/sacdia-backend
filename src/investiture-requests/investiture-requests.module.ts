import { Module } from '@nestjs/common';
import { AchievementsModule } from '../achievements/achievements.module';
import { ClassesModule } from '../classes/classes.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { InvestitureAchievementIntentReconciler } from './investiture-achievement-intent.reconciler';
import { InvestitureAuthorizationRequestsController } from './investiture-authorization-requests.controller';
import { InvestitureAuthorizationRequestService } from './investiture-authorization-requests.service';
import { INVESTITURE_MAIL_GATE } from '../common/email/investiture-mail.gate';
import { InvestitureCommunicationsService } from './investiture-communications.service';
import { InvestitureReminderCron } from './investiture-reminder.cron';

@Module({
  imports: [ClassesModule, AchievementsModule, NotificationsModule],
  controllers: [InvestitureAuthorizationRequestsController],
  providers: [
    InvestitureAuthorizationRequestService,
    InvestitureCommunicationsService,
    {
      provide: INVESTITURE_MAIL_GATE,
      useExisting: InvestitureCommunicationsService,
    },
    InvestitureReminderCron,
    InvestitureAchievementIntentReconciler,
  ],
  exports: [InvestitureAuthorizationRequestService],
})
export class InvestitureRequestsModule {}
