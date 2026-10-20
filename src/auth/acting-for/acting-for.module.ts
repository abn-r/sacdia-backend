import { Module } from '@nestjs/common';
import { ActingForCache } from './acting-for.cache';
import { ActingForResolver } from './acting-for.resolver';
import { SupervisedPrincipalCache } from '../supervised/supervised-principal.cache';
import { SupervisedPrincipalResolver } from '../supervised/supervised-principal.resolver';

/**
 * Acting-for and supervised-principal infrastructure shared by the auth layer
 * (JwtStrategy) and the guardianships module (epoch bump on every mutation). PrismaService,
 * CACHE_MANAGER and CountryAgePolicyService come from the global modules.
 */
@Module({
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
