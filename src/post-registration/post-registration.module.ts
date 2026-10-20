import { Module } from '@nestjs/common';
import { PostRegistrationController } from './post-registration.controller';
import { PostRegistrationService } from './post-registration.service';
import { MembershipRequestsModule } from '../membership-requests/membership-requests.module';
import { ClubRoleEligibilityModule } from '../club-role-eligibility/club-role-eligibility.module';
import { GuardianshipsModule } from '../guardianships/guardianships.module';
import { ActingForModule } from '../auth/acting-for/acting-for.module';

@Module({
  // GuardianEvidenceService: the step-3 consent upload while acting.
  imports: [
    MembershipRequestsModule,
    ClubRoleEligibilityModule,
    GuardianshipsModule,
    // ActingForCache: completing the post-registration moves the principal
    // epoch (the unknown-age restriction reads users_pr.complete).
    ActingForModule,
  ],
  controllers: [PostRegistrationController],
  providers: [PostRegistrationService],
  exports: [PostRegistrationService],
})
export class PostRegistrationModule {}
