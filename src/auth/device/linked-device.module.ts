import { Module } from '@nestjs/common';
import { FamilyFeatureFlagsModule } from '../../guardianships/family-feature-flags.module';
import { ActingForModule } from '../acting-for/acting-for.module';
import { LinkedDeviceGate } from './linked-device.gate';
import { LinkedDeviceRevocation } from './linked-device-revocation';

/**
 * The linked-device core shared by the auth layer (JwtStrategy, refresh, logout,
 * session revoke) and the guardianships module (pair, list, revoke, lifecycle
 * triggers). It depends only on Prisma, the cache, the epoch cache (through
 * ActingForModule), the family flags and the country age policy (global), so it
 * can be imported from both sides without an import cycle.
 */
@Module({
  imports: [ActingForModule, FamilyFeatureFlagsModule],
  providers: [LinkedDeviceRevocation, LinkedDeviceGate],
  exports: [LinkedDeviceRevocation, LinkedDeviceGate],
})
export class LinkedDeviceModule {}
