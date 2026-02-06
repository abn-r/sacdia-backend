import { Module } from '@nestjs/common';
import {
  NotificationsController,
  FcmTokensController,
} from './notifications.controller';
import { NotificationsService } from './notifications.service';
import { FcmTokensService } from './fcm-tokens.service';
import { PrismaModule } from '../prisma/prisma.module';
import { FirebaseAdminModule } from '../config/firebase-admin.module';

@Module({
  imports: [PrismaModule, FirebaseAdminModule],
  controllers: [NotificationsController, FcmTokensController],
  providers: [NotificationsService, FcmTokensService],
  exports: [NotificationsService, FcmTokensService],
})
export class NotificationsModule {}
