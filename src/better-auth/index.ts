export { BetterAuthModule } from './better-auth.module';
export { BetterAuthService } from './better-auth.service';
export type {
  IBetterAuthService,
  BaUser,
  BaSession,
  BaAuthResult,
  BaTotpEnrollResult,
  BaAssuranceLevel,
  BaOAuthUrlResult,
} from './better-auth.service';
export { createBetterAuth } from './better-auth.config';
export type { BetterAuthInstance } from './better-auth.config';
