import { Module } from '@nestjs/common';
import { PostRegistrationController } from './post-registration.controller';
import { PostRegistrationService } from './post-registration.service';
import { UsersModule } from '../users/users.module';
import { LegalRepresentativesModule } from '../legal-representatives/legal-representatives.module';
import { MembershipRequestsModule } from '../membership-requests/membership-requests.module';
import { ClubRoleEligibilityModule } from '../club-role-eligibility/club-role-eligibility.module';

@Module({
  imports: [
    UsersModule,
    LegalRepresentativesModule,
    MembershipRequestsModule,
    ClubRoleEligibilityModule,
  ],
  controllers: [PostRegistrationController],
  providers: [PostRegistrationService],
  exports: [PostRegistrationService],
})
export class PostRegistrationModule {}
