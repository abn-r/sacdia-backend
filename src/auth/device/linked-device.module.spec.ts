import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { CountryAgePolicyService } from '../../common/age/country-age-policy.service';
import { PrismaService } from '../../prisma/prisma.service';
import { LinkedDeviceGate } from './linked-device.gate';
import { LinkedDeviceModule } from './linked-device.module';
import { LinkedDeviceRevocation } from './linked-device-revocation';

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

describe('LinkedDeviceModule', () => {
  it('wires the gate and the revocation core from the real container (no optional bindings)', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [GlobalStubsModule, LinkedDeviceModule],
    }).compile();

    expect(moduleRef.get(LinkedDeviceGate)).toBeInstanceOf(LinkedDeviceGate);
    expect(moduleRef.get(LinkedDeviceRevocation)).toBeInstanceOf(
      LinkedDeviceRevocation,
    );
  });
});
