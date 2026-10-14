import { JwtAuthGuard } from './jwt-auth.guard';
import { ErrorCode } from '../errors/error-codes';
import {
  AppServiceUnavailableException,
  AppUnauthorizedException,
} from '../errors/app.exception';

describe('JwtAuthGuard', () => {
  const mockReflector = {
    getAllAndOverride: jest.fn().mockReturnValue(false),
  };

  const mockContext = {
    getHandler: jest.fn(),
    getClass: jest.fn(),
    switchToHttp: () => ({
      getRequest: () => ({
        method: 'GET',
        url: '/api/v1/auth/me',
      }),
    }),
  } as any;

  it('should return user when authentication succeeds', () => {
    const guard = new JwtAuthGuard(mockReflector as any);
    const user = { user_id: 'user-123' };

    const result = guard.handleRequest(null, user, null, mockContext);

    expect(result).toEqual(user);
  });

  it('should accept user without mfa_pending', () => {
    const guard = new JwtAuthGuard(mockReflector as any);
    const user = { user_id: 'user-123', mfa_pending: false };

    const result = guard.handleRequest(null, user, null, mockContext);

    expect(result).toEqual(user);
  });

  it('should reject user with mfa_pending: true', () => {
    const guard = new JwtAuthGuard(mockReflector as any);
    const user = { user_id: 'user-123', mfa_pending: true };

    expect(() => guard.handleRequest(null, user, null, mockContext)).toThrow(
      expect.objectContaining({ code: ErrorCode.GUARD_MFA_REQUIRED }),
    );
  });

  it('should permit mfa_pending when handler/class has @SkipMfaCheck()', () => {
    mockReflector.getAllAndOverride.mockReturnValueOnce(true);
    const guard = new JwtAuthGuard(mockReflector as any);
    const user = { user_id: 'user-123', mfa_pending: true };

    const result = guard.handleRequest(null, user, null, mockContext);

    expect(result).toEqual(user);
  });

  it('should throw UnauthorizedException when user is missing', () => {
    const guard = new JwtAuthGuard(mockReflector as any);

    expect(() =>
      guard.handleRequest(
        null,
        null,
        { message: 'No auth token' },
        mockContext,
      ),
    ).toThrow(
      expect.objectContaining({ code: ErrorCode.GUARD_JWT_UNAUTHORIZED }),
    );
  });

  describe('revocation check unavailable', () => {
    it('propagates the 503 instead of converting it to a 401', () => {
      const guard = new JwtAuthGuard(mockReflector as any);
      const error = new AppServiceUnavailableException(
        ErrorCode.AUTH_REVOCATION_CHECK_UNAVAILABLE,
      );

      let thrown: unknown;
      try {
        guard.handleRequest(error, false, null, mockContext);
      } catch (caught) {
        thrown = caught;
      }

      expect(thrown).toBe(error);
      expect(thrown).toMatchObject({
        code: ErrorCode.AUTH_REVOCATION_CHECK_UNAVAILABLE,
        status: 503,
      });
    });

    it('still maps other strategy errors and 401s to GUARD_JWT_UNAUTHORIZED', () => {
      const guard = new JwtAuthGuard(mockReflector as any);

      for (const err of [
        new Error('boom'),
        new AppUnauthorizedException(ErrorCode.GUARD_JWT_UNAUTHORIZED),
        // A 503 with another code is not the revocation signal.
        new AppServiceUnavailableException(ErrorCode.R2_UPLOAD_FAILED),
      ]) {
        expect(() =>
          guard.handleRequest(err, false, null, mockContext),
        ).toThrow(
          expect.objectContaining({ code: ErrorCode.GUARD_JWT_UNAUTHORIZED }),
        );
      }
    });
  });
});
