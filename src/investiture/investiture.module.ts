import { Module } from '@nestjs/common';
import { InvestitureController } from './investiture.controller';
import { InvestitureService } from './investiture.service';
import { LegacyInvestitureRetiredController } from './legacy-investiture-retired.controller';
import { LegacyLockReleaseService } from './legacy-lock-release.service';
import { PrismaModule } from '../prisma/prisma.module';
import { ExactSuperAdminWritePolicy } from '../rbac/exact-super-admin-write.policy';

@Module({
  imports: [PrismaModule],
  controllers: [InvestitureController, LegacyInvestitureRetiredController],
  providers: [
    InvestitureService,
    LegacyLockReleaseService,
    ExactSuperAdminWritePolicy,
  ],
  exports: [InvestitureService],
})
export class InvestitureModule {}
