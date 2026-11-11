import { Module } from '@nestjs/common';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { PrismaModule } from '../prisma/prisma.module';
import { AdminRoleRequirementsController } from './admin-role-requirements.controller';
import { AdminRoleRequirementsService } from './admin-role-requirements.service';
import { RoleRequirementService } from './role-requirement.service';

@Module({
  imports: [PrismaModule, AuditLogsModule],
  controllers: [AdminRoleRequirementsController],
  providers: [RoleRequirementService, AdminRoleRequirementsService],
  exports: [RoleRequirementService],
})
export class RoleRequirementsModule {}
