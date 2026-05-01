import { Module } from '@nestjs/common';
import { MembershipRequestsController } from './membership-requests.controller';
import { MembershipRequestsService } from './membership-requests.service';
import { MembershipRequestsCronService } from './membership-requests-cron.service';
import { PrismaModule } from '../prisma/prisma.module';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [PrismaModule, NotificationsModule],
  controllers: [MembershipRequestsController],
  providers: [MembershipRequestsService, MembershipRequestsCronService],
  exports: [MembershipRequestsService],
})
export class MembershipRequestsModule {}
