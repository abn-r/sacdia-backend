import { Module } from '@nestjs/common';
import { PostRegistrationController } from './post-registration.controller';
import { PostRegistrationService } from './post-registration.service';
import { MembershipRequestsModule } from '../membership-requests/membership-requests.module';
import { ClubRoleEligibilityModule } from '../club-role-eligibility/club-role-eligibility.module';

@Module({
  imports: [MembershipRequestsModule, ClubRoleEligibilityModule],
  controllers: [PostRegistrationController],
  providers: [PostRegistrationService],
  exports: [PostRegistrationService],
})
export class PostRegistrationModule {}
