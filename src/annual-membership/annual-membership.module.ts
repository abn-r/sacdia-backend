import { Module } from '@nestjs/common';
import { AnnualContinuationsController } from './annual-continuations.controller';
import { AnnualEnrollController } from './annual-enroll.controller';
import { AnnualMembershipService } from './annual-membership.service';
import { AnnualMembershipPolicyService } from './annual-membership-policy.service';
import { PrismaModule } from '../prisma/prisma.module';
import { CommonModule } from '../common/common.module';
import { ClassesModule } from '../classes/classes.module';
import { AuditLogsService } from '../audit-logs/audit-logs.service';

/**
 * AnnualMembershipModule — inscripción anual por directiva.
 *
 * Endpoints:
 *   GET  /api/v1/club-sections/:sectionId/annual-continuations
 *   POST /api/v1/club-sections/:sectionId/annual-continuations
 *   POST /api/v1/users/:userId/membership/annual-enroll (D01: 403)
 */
@Module({
  imports: [PrismaModule, CommonModule, ClassesModule],
  controllers: [AnnualContinuationsController, AnnualEnrollController],
  providers: [
    AnnualMembershipService,
    AnnualMembershipPolicyService,
    AuditLogsService,
  ],
  exports: [AnnualMembershipService, AnnualMembershipPolicyService],
})
export class AnnualMembershipModule {}
