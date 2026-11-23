import { Module } from '@nestjs/common';
import { ActingForModule } from '../../auth/acting-for/acting-for.module';
import { OnboardingModeService } from './onboarding-mode.service';

/**
 * Lower-level module: it only needs ActingForCache (ActingForModule imports
 * nothing but the flags module) plus the global Prisma and CommonModule
 * providers, so PostRegistration, MembershipRequests and Auth can all import
 * it without a cycle.
 */
@Module({
  imports: [ActingForModule],
  providers: [OnboardingModeService],
  exports: [OnboardingModeService],
})
export class OnboardingModeModule {}
