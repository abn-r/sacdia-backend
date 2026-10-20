import { Module } from '@nestjs/common';
import { ActingForCache } from './acting-for.cache';
import { ActingForResolver } from './acting-for.resolver';
import { SupervisedPrincipalCache } from '../supervised/supervised-principal.cache';
import { SupervisedPrincipalResolver } from '../supervised/supervised-principal.resolver';
import { FamilyFeatureFlagsModule } from '../../guardianships/family-feature-flags.module';

/**
 * Acting-for and supervised-principal infrastructure shared by the auth layer
 * (JwtStrategy) and the guardianships module (epoch bump on every mutation). PrismaService,
 * CACHE_MANAGER and CountryAgePolicyService come from the global modules. The
 * family flags module imports nothing, so importing it here adds no cycle (the
 * resolver cuts handle sessions while FAMILY_TEEN_LOGIN_ENABLED is off).
 */
@Module({
  imports: [FamilyFeatureFlagsModule],
  providers: [
    ActingForCache,
    ActingForResolver,
    SupervisedPrincipalCache,
    SupervisedPrincipalResolver,
  ],
  exports: [
    ActingForCache,
    ActingForResolver,
    SupervisedPrincipalCache,
    SupervisedPrincipalResolver,
  ],
})
export class ActingForModule {}
