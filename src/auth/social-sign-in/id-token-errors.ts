import type { Logger } from '@nestjs/common';
import { errors } from 'jose';
import {
  AppServiceUnavailableException,
  AppUnauthorizedException,
} from '../../common/errors/app.exception';
import { ErrorCode } from '../../common/errors/error-codes';
import type { SocialProvider } from './social-sign-in.types';

/**
 * Turns a `jwtVerify` failure into the API error the client sees.
 *
 * Every verification failure (signature, iss, aud, exp, unknown kid, malformed
 * token) is a 401 — the token is not usable, whatever the reason. Only a JWKS
 * outage (timeout or network error while fetching the provider keys) is a 503,
 * because retrying later can succeed.
 *
 * The log line carries the jose error code, never the token.
 */
export function mapIdTokenError(
  cause: unknown,
  logger: Logger,
  provider: SocialProvider,
): AppUnauthorizedException | AppServiceUnavailableException {
  if (
    cause instanceof errors.JOSEError &&
    !(cause instanceof errors.JWKSTimeout)
  ) {
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
