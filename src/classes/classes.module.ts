import { Module } from '@nestjs/common';
import { ClassesController, UserClassesController } from './classes.controller';
import { ClassCounselorAssignmentsController } from './class-counselor-assignments.controller';
import { ClassProgressScopeController } from './class-progress-scope.controller';
import { ClassesService } from './classes.service';
import { ClassCounselorAssignmentsService } from './class-counselor-assignments.service';
import { ClassProgressAccessService } from './class-progress-access.service';
import { ClassProgressScopeService } from './class-progress-scope.service';
import { ClassRequirementEligibilityService } from './class-requirement-eligibility.service';
import { NextClassResolver } from './next-class.resolver';
import { ClassEnrollmentPolicyService } from './class-enrollment-policy.service';
import { ClassEnrollmentWriter } from './class-enrollment-writer.service';
import { PrismaModule } from '../prisma/prisma.module';
import { AchievementsModule } from '../achievements/achievements.module';
import { CoordinationModule } from '../coordination/coordination.module';

@Module({
  imports: [PrismaModule, AchievementsModule, CoordinationModule],
  controllers: [
    ClassesController,
    UserClassesController,
    ClassCounselorAssignmentsController,
    ClassProgressScopeController,
  ],
  providers: [
    ClassesService,
    ClassCounselorAssignmentsService,
    ClassProgressAccessService,
    ClassProgressScopeService,
    ClassRequirementEligibilityService,
    NextClassResolver,
    ClassEnrollmentPolicyService,
    ClassEnrollmentWriter,
  ],
  exports: [
    ClassesService,
    ClassCounselorAssignmentsService,
    ClassProgressAccessService,
    ClassProgressScopeService,
    ClassRequirementEligibilityService,
    NextClassResolver,
    ClassEnrollmentPolicyService,
    ClassEnrollmentWriter,
  ],
})
export class ClassesModule {}
