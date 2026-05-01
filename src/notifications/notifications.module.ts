import { Module } from '@nestjs/common';
import {
  NotificationsController,
  FcmTokensController,
} from './notifications.controller';
import { UserNotificationPreferencesController } from './user-notification-preferences.controller';
import { NotificationsService } from './notifications.service';
import { NotificationPreferencesService } from './notification-preferences.service';
import { FcmTokensService } from './fcm-tokens.service';
import {
  NotificationsProcessor,
  NOTIFICATIONS_QUEUE,
} from './notifications.processor';
import { PrismaModule } from '../prisma/prisma.module';
import { FirebaseAdminModule } from '../config/firebase-admin.module';
import { BullModule } from '@nestjs/bullmq';
import { isPlaceholderUrl } from '../config/bullmq.config';

/**
 * Checks whether a valid REDIS_URL is available in process.env.
 *
 * This function runs at file-load time (inside the @Module decorator body).
 * It works correctly only when dotenv has already been loaded before this
 * module file is imported. `main.ts` must have `import 'dotenv/config'` as
 * its first import to guarantee this ordering.
 */
function isRedisConfigured(): boolean {
  const rawUrl = process.env.REDIS_URL?.trim();
  if (!rawUrl || isPlaceholderUrl(rawUrl)) return false;
  try {
    new URL(rawUrl);
    return true;
  } catch {
    return false;
  }
}

@Module({
  imports: [
    PrismaModule,
    FirebaseAdminModule,
    ...(isRedisConfigured()
      ? [BullModule.registerQueue({ name: NOTIFICATIONS_QUEUE })]
      : []),
  ],
  controllers: [
    NotificationsController,
    FcmTokensController,
    UserNotificationPreferencesController,
  ],
  providers: [
    NotificationsService,
    NotificationPreferencesService,
    FcmTokensService,
    ...(isRedisConfigured() ? [NotificationsProcessor] : []),
  ],
  exports: [
    NotificationsService,
    NotificationPreferencesService,
    FcmTokensService,
  ],
})
export class NotificationsModule {}
