import { Module } from '@nestjs/common';
import { InvestitureController } from './investiture.controller';
import { InvestitureService } from './investiture.service';
import { PrismaModule } from '../prisma/prisma.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { AchievementsModule } from '../achievements/achievements.module';

@Module({
  imports: [PrismaModule, NotificationsModule, AchievementsModule],
  controllers: [InvestitureController],
  providers: [InvestitureService],
  exports: [InvestitureService],
})
export class InvestitureModule {}
