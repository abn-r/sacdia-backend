import { Module } from '@nestjs/common';
import { MemberOfMonthController } from './member-of-month.controller';
import { MemberOfMonthService } from './member-of-month.service';
import { MemberOfMonthCronService } from './member-of-month-cron.service';
import { PrismaModule } from '../prisma/prisma.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { AchievementsModule } from '../achievements/achievements.module';
import { CoordinationModule } from '../coordination/coordination.module';

@Module({
  imports: [
    PrismaModule,
    NotificationsModule,
    AchievementsModule,
    CoordinationModule,
  ],
  controllers: [MemberOfMonthController],
  providers: [MemberOfMonthService, MemberOfMonthCronService],
  exports: [MemberOfMonthService],
})
export class MemberOfMonthModule {}
