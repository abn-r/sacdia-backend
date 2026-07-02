import { Module } from '@nestjs/common';
import { DashboardController } from './dashboard.controller';
import { DashboardService } from './dashboard.service';
import { PrismaModule } from '../prisma/prisma.module';
import { ClassesModule } from '../classes/classes.module';

@Module({
  imports: [PrismaModule, ClassesModule],
  controllers: [DashboardController],
  providers: [DashboardService],
})
export class DashboardModule {}
