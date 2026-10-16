import { ErrorCode } from '../errors/error-codes';
import {
  AppServiceUnavailableException,
  AppUnauthorizedException,
} from '../errors/app.exception';
import { Reflector } from '@nestjs/core';
import { OptionalJwtAuthGuard } from './optional-jwt-auth.guard';

describe('OptionalJwtAuthGuard', () => {
  const guard = new OptionalJwtAuthGuard(new Reflector());
  const context = {} as any;

  it('attaches the user when authentication succeeds', () => {
    const user = { user_id: 'user-123' };

    expect(guard.handleRequest(null, user, null, context)).toBe(user);
  });

  it('continues as anonymous when there is no token', () => {
    expect(
      guard.handleRequest(null, false, { message: 'No auth token' }, context),
    ).toBeNull();
  });

  it('continues as anonymous when the token is invalid or revoked (401)', () => {
    expect(
      guard.handleRequest(
        new AppUnauthorizedException(ErrorCode.GUARD_JWT_UNAUTHORIZED),
        false,
        null,
        context,
      ),
    ).toBeNull();
  });

  it('propagates the 503 instead of silently downgrading to anonymous', () => {
    const error = new AppServiceUnavailableException(
      ErrorCode.AUTH_REVOCATION_CHECK_UNAVAILABLE,
    );

    expect(() => guard.handleRequest(error, false, null, context)).toThrow(
      error,
    );
  });

  it('does not treat unrelated 503s as the revocation signal', () => {
    expect(
      guard.handleRequest(
        new AppServiceUnavailableException(ErrorCode.R2_UPLOAD_FAILED),
        false,
        null,
        context,
      ),
    ).toBeNull();
  });
});
