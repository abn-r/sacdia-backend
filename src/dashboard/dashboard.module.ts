import { Module } from '@nestjs/common';
import { DashboardController } from './dashboard.controller';
import { DashboardService } from './dashboard.service';
import { PrismaModule } from '../prisma/prisma.module';
import { ClassesModule } from '../classes/classes.module';
import { CatalogsModule } from '../catalogs/catalogs.module';
import { MembershipRequestsModule } from '../membership-requests/membership-requests.module';
import { InvestitureRequestsModule } from '../investiture-requests/investiture-requests.module';
import { DashboardPendingService } from './dashboard-pending.service';

@Module({
  imports: [
    PrismaModule,
    ClassesModule,
    CatalogsModule,
    MembershipRequestsModule,
    InvestitureRequestsModule,
  ],
  controllers: [DashboardController],
  providers: [DashboardService, DashboardPendingService],
})
export class DashboardModule {}
