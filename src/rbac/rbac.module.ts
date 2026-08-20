import { Module } from '@nestjs/common';
import { RbacController, RbacBootstrapController } from './rbac.controller';
import { RbacService } from './rbac.service';
import { PrismaModule } from '../prisma/prisma.module';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { ExactSuperAdminWritePolicy } from './exact-super-admin-write.policy';

@Module({
  imports: [PrismaModule],
  controllers: [RbacController, RbacBootstrapController],
  providers: [RbacService, ExactSuperAdminWritePolicy, AuditLogsService],
  exports: [RbacService, ExactSuperAdminWritePolicy],
})
export class RbacModule {}
