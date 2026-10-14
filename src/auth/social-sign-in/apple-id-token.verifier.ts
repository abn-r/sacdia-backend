import { Logger } from '@nestjs/common';
import { createHash } from 'crypto';
import { jwtVerify, type JWTPayload, type JWTVerifyGetKey } from 'jose';
import { AppUnauthorizedException } from '../../common/errors/app.exception';
import { ErrorCode } from '../../common/errors/error-codes';
import { mapIdTokenError } from './id-token-errors';
import {
  truncateSub,
  type IdTokenVerifier,
  type VerifiedIdentity,
} from './social-sign-in.types';

export const APPLE_JWKS_URL = 'https://appleid.apple.com/auth/keys';
export const APPLE_ISSUER = 'https://appleid.apple.com';

export interface AppleIdTokenVerifierOptions {
  /** iOS bundle identifier — the `aud` of native Sign in with Apple tokens. */
  bundleId: string;
  getKey: JWTVerifyGetKey;
}

/** Apple puts SHA-256(nonce) in the token; the app sends the raw nonce. */
export function hashAppleNonce(nonce: string): string {
  return createHash('sha256').update(nonce).digest('hex');
}

export class AppleIdTokenVerifier implements IdTokenVerifier {
  readonly provider = 'apple' as const;
  private readonly logger = new Logger(AppleIdTokenVerifier.name);

  constructor(private readonly options: AppleIdTokenVerifierOptions) {
    if (!options.bundleId) {
      this.logger.error(
        'APPLE_BUNDLE_ID is empty — every Apple id token will be rejected',
      );
    }
  }

  async verify(idToken: string, nonce: string): Promise<VerifiedIdentity> {
    if (!this.options.bundleId) {
      throw new AppUnauthorizedException(ErrorCode.AUTH_INVALID_TOKEN);
    }

    let payload: JWTPayload;
    try {
      ({ payload } = await jwtVerify(idToken, this.options.getKey, {
        issuer: APPLE_ISSUER,
        audience: this.options.bundleId,
        algorithms: ['RS256'],
      }));
    } catch (error) {
      throw mapIdTokenError(error, this.logger, this.provider);
    }

    if (typeof payload.sub !== 'string' || payload.sub.length === 0) {
      this.logger.warn('apple id token rejected — missing sub');
      throw new AppUnauthorizedException(ErrorCode.AUTH_INVALID_TOKEN);
    }
    if (payload.nonce !== hashAppleNonce(nonce)) {
      this.logger.warn(
        `apple id token rejected — nonce mismatch (sub ${truncateSub(payload.sub)})`,
      );
      throw new AppUnauthorizedException(ErrorCode.AUTH_INVALID_TOKEN);
    }

    // The app passes SHA-256(nonce) to the Apple SDK, so the token carries the
    // hash while we receive the raw nonce. Apple never includes the name in the
    // token: the app sends it on the first sign-in as `fullName`.
    return {
      provider: this.provider,
      sub: payload.sub,
      email: typeof payload.email === 'string' ? payload.email : null,
      emailVerified: isTrue(payload.email_verified),
    };
  }
}

/** Apple sends `email_verified` as the string "true" on some tokens. */
function isTrue(value: unknown): boolean {
  return value === true || value === 'true';
}
