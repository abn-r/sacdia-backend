import { Module } from '@nestjs/common';
import { MemberOfMonthController } from './member-of-month.controller';
import { MemberOfMonthService } from './member-of-month.service';
import { MemberOfMonthCronService } from './member-of-month-cron.service';
import { PrismaModule } from '../prisma/prisma.module';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [PrismaModule, NotificationsModule],
  controllers: [MemberOfMonthController],
  providers: [MemberOfMonthService, MemberOfMonthCronService],
  exports: [MemberOfMonthService],
})
export class MemberOfMonthModule {}
