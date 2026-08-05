import { Module } from '@nestjs/common';
import { RbacController, RbacBootstrapController } from './rbac.controller';
import { RbacService } from './rbac.service';
import { PrismaModule } from '../prisma/prisma.module';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import {
  ExactSuperAdminWriteGuard,
  ExactSuperAdminWritePolicy,
} from './exact-super-admin-write.policy';
import { GlobalUserRoleWriteService } from './global-user-role-write.service';

@Module({
  imports: [PrismaModule, AuditLogsModule],
  controllers: [RbacController, RbacBootstrapController],
  providers: [
    RbacService,
    ExactSuperAdminWritePolicy,
    ExactSuperAdminWriteGuard,
    GlobalUserRoleWriteService,
  ],
  exports: [
    RbacService,
    ExactSuperAdminWritePolicy,
    GlobalUserRoleWriteService,
  ],
})
export class RbacModule {}
