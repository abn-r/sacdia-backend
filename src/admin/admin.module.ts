import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { AdminGeographyController } from './admin-geography.controller';
import { AdminReferenceController } from './admin-reference.controller';
import { AdminUsersController } from './admin-users.controller';
import { AdminGeographyService } from './admin-geography.service';
import { AdminReferenceService } from './admin-reference.service';
import { AdminUsersService } from './admin-users.service';

@Module({
  imports: [PrismaModule],
  controllers: [
    AdminGeographyController,
    AdminReferenceController,
    AdminUsersController,
  ],
  providers: [AdminGeographyService, AdminReferenceService, AdminUsersService],
})
export class AdminModule {}
