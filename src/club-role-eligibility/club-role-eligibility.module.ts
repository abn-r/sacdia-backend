import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { ClubRoleEligibilityService } from './club-role-eligibility.service';

/**
 * Standalone so batch modules (annual-membership, year-cut, requests...) can
 * import it without pulling ClubsModule; its only dependency is Prisma.
 */
@Module({
  imports: [PrismaModule],
  providers: [ClubRoleEligibilityService],
  exports: [ClubRoleEligibilityService],
})
export class ClubRoleEligibilityModule {}
