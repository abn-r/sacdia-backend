import { Module } from '@nestjs/common';
import { RbacController, RbacBootstrapController } from './rbac.controller';
import { RbacService } from './rbac.service';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [RbacController, RbacBootstrapController],
  providers: [RbacService],
  exports: [RbacService],
})
export class RbacModule {}
