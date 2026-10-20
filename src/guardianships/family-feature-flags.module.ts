import { Module } from '@nestjs/common';
import { FamilyFeatureFlagsService } from './family-feature-flags.service';

/**
 * Standalone module for the Phase 3 family flags. It imports nothing (the
 * ConfigService is global), so the auth layer (BetterAuthModule) and the
 * guardianships module can both depend on it without creating an import cycle.
 */
@Module({
  providers: [FamilyFeatureFlagsService],
  exports: [FamilyFeatureFlagsService],
})
export class FamilyFeatureFlagsModule {}
