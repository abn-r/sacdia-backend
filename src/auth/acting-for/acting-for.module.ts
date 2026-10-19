import { Module } from '@nestjs/common';
import { ActingForCache } from './acting-for.cache';
import { ActingForResolver } from './acting-for.resolver';

/**
 * Acting-for infrastructure shared by the auth layer (JwtStrategy) and the
 * guardianships module (epoch bump on every mutation). PrismaService,
 * CACHE_MANAGER and CountryAgePolicyService come from the global modules.
 */
@Module({
  providers: [ActingForCache, ActingForResolver],
  exports: [ActingForCache, ActingForResolver],
})
export class ActingForModule {}
