import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { CommonModule } from '../common/common.module';
import { CoordinationModule } from '../coordination/coordination.module';
import { ReportsComplianceController } from './reports-compliance.controller';
import { ReportsComplianceService } from './reports-compliance.service';

@Module({
  imports: [PrismaModule, CommonModule, CoordinationModule],
  controllers: [ReportsComplianceController],
  providers: [ReportsComplianceService],
})
export class ReportsModule {}
