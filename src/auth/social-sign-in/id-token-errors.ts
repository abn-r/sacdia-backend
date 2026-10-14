import type { Logger } from '@nestjs/common';
import { errors } from 'jose';
import {
  AppServiceUnavailableException,
  AppUnauthorizedException,
} from '../../common/errors/app.exception';
import { ErrorCode } from '../../common/errors/error-codes';
import type { SocialProvider } from './social-sign-in.types';

/**
 * jose reports a failed JWKS fetch as a bare `JOSEError` (non-200 answer or an
 * unparseable body, code ERR_JOSE_GENERIC), `JWKSInvalid` (malformed key set)
 * or `JWKSTimeout`. Those are provider outages, not bad tokens.
 */
const JWKS_OUTAGE_CODES: ReadonlySet<string> = new Set([
  'ERR_JOSE_GENERIC',
  'ERR_JWKS_INVALID',
  'ERR_JWKS_TIMEOUT',
]);

/**
 * Turns a `jwtVerify` failure into the API error the client sees.
 *
 * Every verification failure (signature, iss, aud, exp, unknown kid, malformed
 * token) is a 401 — the token is not usable, whatever the reason. Only a JWKS
 * outage (timeout or network error while fetching the provider keys) is a 503,
 * because retrying later can succeed (see JWKS_OUTAGE_CODES).
 *
 * The log line carries the jose error code, never the token.
 */
export function mapIdTokenError(
  cause: unknown,
  logger: Logger,
  provider: SocialProvider,
): AppUnauthorizedException | AppServiceUnavailableException {
  if (cause instanceof errors.JOSEError && !JWKS_OUTAGE_CODES.has(cause.code)) {
    logger.warn(
      `${provider} id token rejected — ${cause.code}: ${cause.message}`,
    );
    return new AppUnauthorizedException(ErrorCode.AUTH_INVALID_TOKEN);
  }
  const message = cause instanceof Error ? cause.message : String(cause);
  logger.error(`${provider} JWKS unavailable — ${message}`);
  return new AppServiceUnavailableException(
    ErrorCode.AUTH_OAUTH_PROVIDER_UNAVAILABLE,
  );
}
