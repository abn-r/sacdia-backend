import { Global, Module } from '@nestjs/common';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { CountryAgePolicyService } from '../../common/age/country-age-policy.service';
import { PrismaService } from '../../prisma/prisma.service';
import { ActingForCache } from './acting-for.cache';
import { ActingForModule } from './acting-for.module';
import { ActingForResolver } from './acting-for.resolver';
import { SupervisedPrincipalResolver } from '../supervised/supervised-principal.resolver';

/** Stand-in for the global modules (Prisma, Cache, Common, Config) the module relies on. */
@Global()
@Module({
  providers: [
    { provide: PrismaService, useValue: {} },
    { provide: CACHE_MANAGER, useValue: {} },
    { provide: CountryAgePolicyService, useValue: {} },
    { provide: ConfigService, useValue: { get: () => undefined } },
  ],
  exports: [
    PrismaService,
    CACHE_MANAGER,
    CountryAgePolicyService,
    ConfigService,
  ],
})
class GlobalStubsModule {}

describe('ActingForModule', () => {
  it('wires the resolver and the cache from the global providers', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [GlobalStubsModule, ActingForModule],
    }).compile();

    expect(moduleRef.get(ActingForResolver)).toBeInstanceOf(ActingForResolver);
    expect(moduleRef.get(ActingForCache)).toBeInstanceOf(ActingForCache);
    // The supervised resolver reads the family flags (FP3-35).
    expect(moduleRef.get(SupervisedPrincipalResolver)).toBeInstanceOf(
      SupervisedPrincipalResolver,
    );
  });
});
