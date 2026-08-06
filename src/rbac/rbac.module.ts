import { Module } from '@nestjs/common';
import { RbacController, RbacBootstrapController } from './rbac.controller';
import { RbacService } from './rbac.service';
import { PrismaModule } from '../prisma/prisma.module';
import { ExactSuperAdminWritePolicy } from './exact-super-admin-write.policy';

@Module({
  imports: [PrismaModule],
  controllers: [RbacController, RbacBootstrapController],
  providers: [RbacService, ExactSuperAdminWritePolicy],
  exports: [RbacService, ExactSuperAdminWritePolicy],
})
export class RbacModule {}
