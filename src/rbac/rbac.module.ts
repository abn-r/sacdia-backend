import { Module } from '@nestjs/common';
import { RbacController, RbacBootstrapController } from './rbac.controller';
import { RbacService } from './rbac.service';
import { PrismaModule } from '../prisma/prisma.module';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { ExactSuperAdminWritePolicy } from './exact-super-admin-write.policy';
import { GlobalUserRoleWriteService } from './global-user-role-write.service';

@Module({
  imports: [PrismaModule, AuditLogsModule],
  controllers: [RbacController, RbacBootstrapController],
  providers: [
    RbacService,
    ExactSuperAdminWritePolicy,
    GlobalUserRoleWriteService,
    AuditLogsService,
  ],
  exports: [
    RbacService,
    ExactSuperAdminWritePolicy,
    GlobalUserRoleWriteService,
  ],
})
export class RbacModule {}
