import { Module } from '@nestjs/common';
import {
  NotificationsController,
  FcmTokensController,
} from './notifications.controller';
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

function isRedisConfigured(): boolean {
  const rawUrl = process.env.REDIS_URL?.trim();
  if (!rawUrl) return false;
  const placeholders = ['YOUR_PASSWORD', 'YOUR_REGION', 'YOUR_PORT'];
  if (placeholders.some((p) => rawUrl.includes(p))) return false;
  try {
    new URL(rawUrl);
    return true;
  } catch {
    return false;
  }
}

const queueImports = isRedisConfigured()
  ? [BullModule.registerQueue({ name: NOTIFICATIONS_QUEUE })]
  : [];

@Module({
  imports: [PrismaModule, FirebaseAdminModule, ...queueImports],
  controllers: [NotificationsController, FcmTokensController],
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
