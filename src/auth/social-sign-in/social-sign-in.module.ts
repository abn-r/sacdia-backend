import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createRemoteJWKSet } from 'jose';
import { BetterAuthModule } from '../../better-auth/better-auth.module';
import {
  AppleIdTokenVerifier,
  APPLE_JWKS_URL,
} from './apple-id-token.verifier';
import { AppleTokenClient } from './apple-token.client';
import {
  GoogleIdTokenVerifier,
  GOOGLE_JWKS_URL,
} from './google-id-token.verifier';
import { SocialAccountResolver } from './social-account.resolver';
import { SocialSignInController } from './social-sign-in.controller';
import { SocialSignInService } from './social-sign-in.service';
import {
  APPLE_ID_TOKEN_VERIFIER,
  GOOGLE_ID_TOKEN_VERIFIER,
  parseCsv,
} from './social-sign-in.types';

/** jose caches the JWKS; 5 s is the fetch timeout, not a cache TTL. */
const JWKS_OPTIONS = { timeoutDuration: 5_000 };

/**
 * Native social sign-in for the mobile app.
 * Design: native social sign-in (sacdia workspace
 * docs/plans/2026-10-14-native-social-sign-in-design.md).
 */
@Module({
  imports: [BetterAuthModule],
  controllers: [SocialSignInController],
  providers: [
    {
      provide: GOOGLE_ID_TOKEN_VERIFIER,
      inject: [ConfigService],
      useFactory: (config: ConfigService) =>
        new GoogleIdTokenVerifier({
          audiences: parseCsv(config.get<string>('GOOGLE_OAUTH_AUDIENCES')),
          getKey: createRemoteJWKSet(new URL(GOOGLE_JWKS_URL), JWKS_OPTIONS),
        }),
    },
    {
      provide: APPLE_ID_TOKEN_VERIFIER,
      inject: [ConfigService],
      useFactory: (config: ConfigService) =>
        new AppleIdTokenVerifier({
          bundleId: config.get<string>('APPLE_BUNDLE_ID') ?? '',
          getKey: createRemoteJWKSet(new URL(APPLE_JWKS_URL), JWKS_OPTIONS),
        }),
    },
    AppleTokenClient,
    SocialAccountResolver,
    SocialSignInService,
  ],
  exports: [
    GOOGLE_ID_TOKEN_VERIFIER,
    APPLE_ID_TOKEN_VERIFIER,
    AppleTokenClient,
  ],
})
export class SocialSignInModule {}
