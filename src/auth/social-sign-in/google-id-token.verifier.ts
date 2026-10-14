import { Logger } from '@nestjs/common';
import { jwtVerify, type JWTPayload, type JWTVerifyGetKey } from 'jose';
import { AppUnauthorizedException } from '../../common/errors/app.exception';
import { ErrorCode } from '../../common/errors/error-codes';
import { mapIdTokenError } from './id-token-errors';
import {
  truncateSub,
  type IdTokenVerifier,
  type VerifiedIdentity,
} from './social-sign-in.types';

export const GOOGLE_JWKS_URL = 'https://www.googleapis.com/oauth2/v3/certs';
/** Google issues both forms depending on the SDK. */
export const GOOGLE_ISSUERS = [
  'accounts.google.com',
  'https://accounts.google.com',
];

export interface GoogleIdTokenVerifierOptions {
  /** Client IDs accepted as `aud` (GOOGLE_OAUTH_AUDIENCES). */
  audiences: string[];
  /** `createRemoteJWKSet(GOOGLE_JWKS_URL)` in production, a local set in tests. */
  getKey: JWTVerifyGetKey;
}

export class GoogleIdTokenVerifier implements IdTokenVerifier {
  readonly provider = 'google' as const;
  private readonly logger = new Logger(GoogleIdTokenVerifier.name);

  constructor(private readonly options: GoogleIdTokenVerifierOptions) {
    if (options.audiences.length === 0) {
      this.logger.error(
        'GOOGLE_OAUTH_AUDIENCES is empty — every Google id token will be rejected',
      );
    }
  }

  async verify(idToken: string, nonce: string): Promise<VerifiedIdentity> {
    if (typeof nonce !== 'string' || nonce.length === 0) {
      this.logger.warn('google id token rejected — missing nonce');
      throw new AppUnauthorizedException(ErrorCode.AUTH_INVALID_TOKEN);
    }
    if (this.options.audiences.length === 0) {
      throw new AppUnauthorizedException(ErrorCode.AUTH_INVALID_TOKEN);
    }

    let payload: JWTPayload;
    try {
      ({ payload } = await jwtVerify(idToken, this.options.getKey, {
        issuer: GOOGLE_ISSUERS,
        audience: this.options.audiences,
        algorithms: ['RS256'],
      }));
    } catch (error) {
      throw mapIdTokenError(error, this.logger, this.provider);
    }

    if (typeof payload.sub !== 'string' || payload.sub.length === 0) {
      this.logger.warn('google id token rejected — missing sub');
      throw new AppUnauthorizedException(ErrorCode.AUTH_INVALID_TOKEN);
    }
    // Google passes the nonce through untouched (Apple hashes it, see
    // AppleIdTokenVerifier). A missing nonce is a replayable token: reject.
    if (typeof payload.nonce !== 'string' || payload.nonce !== nonce) {
      this.logger.warn(
        `google id token rejected — nonce mismatch (sub ${truncateSub(payload.sub)})`,
      );
      throw new AppUnauthorizedException(ErrorCode.AUTH_INVALID_TOKEN);
    }

    return {
      provider: this.provider,
      sub: payload.sub,
      email: typeof payload.email === 'string' ? payload.email : null,
      emailVerified: payload.email_verified === true,
      givenName: optionalString(payload.given_name),
      familyName: optionalString(payload.family_name),
      picture: optionalString(payload.picture),
    };
  }
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}
