import { Module } from '@nestjs/common';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { ClassesModule } from '../classes/classes.module';
import { PrismaModule } from '../prisma/prisma.module';
import { GuardianSummaryController } from './guardian-summary.controller';
import { GuardianSummaryService } from './guardian-summary.service';
import { GuardianshipsModule } from './guardianships.module';

/**
 * The guardian summary reads class progress, so it lives in its own module:
 * ClassesModule already imports GuardianshipsModule (consent hooks), and
 * GuardianshipsModule cannot import ClassesModule back without a cycle.
 * CountryAgePolicyService and EcclesiasticalYearService are global.
 */
@Module({
  imports: [PrismaModule, AuditLogsModule, ClassesModule, GuardianshipsModule],
  controllers: [GuardianSummaryController],
  providers: [GuardianSummaryService],
})
export class GuardianSummaryModule {}
