import { Logger } from '@nestjs/common';
import { errors } from 'jose';
import {
  AppServiceUnavailableException,
  AppUnauthorizedException,
} from '../../common/errors/app.exception';
import { ErrorCode } from '../../common/errors/error-codes';
import { mapIdTokenError } from './id-token-errors';

describe('mapIdTokenError', () => {
  const logger = new Logger('test');
  let warn: jest.SpyInstance;
  let error: jest.SpyInstance;

  beforeEach(() => {
    warn = jest.spyOn(logger, 'warn').mockImplementation(() => undefined);
    error = jest.spyOn(logger, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => jest.restoreAllMocks());

  it.each([
    ['expired', new errors.JWTExpired('exp', {}, 'exp', 'check_failed')],
    ['bad signature', new errors.JWSSignatureVerificationFailed()],
    ['no matching key', new errors.JWKSNoMatchingKey()],
    [
      'claim mismatch',
      new errors.JWTClaimValidationFailed('aud', {}, 'aud', 'check_failed'),
    ],
    ['malformed', new errors.JWTInvalid('bad')],
  ])('maps %s to 401 AUTH_INVALID_TOKEN', (_label, cause) => {
    const mapped = mapIdTokenError(cause, logger, 'google');
    expect(mapped).toBeInstanceOf(AppUnauthorizedException);
    expect((mapped as AppUnauthorizedException).code).toBe(
      ErrorCode.AUTH_INVALID_TOKEN,
    );
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('google id token rejected'),
    );
  });

  it('maps a JWKS timeout to 503 AUTH_OAUTH_PROVIDER_UNAVAILABLE', () => {
    const mapped = mapIdTokenError(new errors.JWKSTimeout(), logger, 'apple');
    expect(mapped).toBeInstanceOf(AppServiceUnavailableException);
    expect((mapped as AppServiceUnavailableException).code).toBe(
      ErrorCode.AUTH_OAUTH_PROVIDER_UNAVAILABLE,
    );
    expect(error).toHaveBeenCalledWith(
      expect.stringContaining('apple JWKS unavailable'),
    );
  });

  it('maps a network failure (non-jose error) to 503', () => {
    const mapped = mapIdTokenError(new TypeError('fetch failed'), logger, 'google');
    expect(mapped).toBeInstanceOf(AppServiceUnavailableException);
  });
});
