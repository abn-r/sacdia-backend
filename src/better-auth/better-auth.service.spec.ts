import {
  ConflictException,
  InternalServerErrorException,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { BetterAuthService } from './better-auth.service';

/**
 * BetterAuthService unit tests — Option C custom HS256 JWT.
 *
 * The BA instance is fully mocked via the 'BETTER_AUTH_INSTANCE' injection token.
 * JwtService is also mocked to control signJwt output.
 * We test orchestration logic, error mapping, and JWT structure without
 * hitting a real BA server or signing with a real key.
 */
describe('BetterAuthService', () => {
  let service: BetterAuthService;

  // -- BA API mocks ----------------------------------------------------------
  const mockSignUpEmail = jest.fn();
  const mockSignInEmail = jest.fn();
  const mockGetSession = jest.fn();
  const mockRevokeSession = jest.fn();
  const mockRequestPasswordReset = jest.fn();

  const mockBaInstance = {
    api: {
      signUpEmail: mockSignUpEmail,
      signInEmail: mockSignInEmail,
      getSession: mockGetSession,
      revokeSession: mockRevokeSession,
      requestPasswordReset: mockRequestPasswordReset,
    },
  };

  // -- Shared fixtures -------------------------------------------------------
  const mockUser = {
    user_id: 'user-uuid-123',
    id: 'user-uuid-123',
    email: 'test@example.com',
    name: 'Test User',
    emailVerified: true,
    user_image: null,
    created_at: new Date('2026-01-01'),
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
  };

  const mockSession = {
    id: 'session-id-abc',
    userId: 'user-uuid-123',
    token: 'raw-opaque-session-token',
    expiresAt: new Date(Date.now() + 7 * 86400 * 1000),
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
  };

  // This is what BA's getSession returns — the service casts it to BaUser/BaSession
  const mockGetSessionResult = {
    user: mockUser,
    session: mockSession,
  };

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.BETTER_AUTH_SECRET = 'test-secret-min-32-chars-for-hs256-hmac';
  });

  // ---------------------------------------------------------------------------
  // signJwt — the core Option C method
  // ---------------------------------------------------------------------------

  describe('signJwt', () => {
    it('should return a valid 3-part JWT string', () => {
      // Use real JwtService with a known secret to verify JWT structure
      const realJwtService = new JwtService({
        secret: 'test-secret-min-32-chars-for-hs256-hmac',
        signOptions: { expiresIn: '1h', algorithm: 'HS256' },
      });
      service = new BetterAuthService(realJwtService, mockBaInstance as any);

      const token = service.signJwt({ id: 'user-uuid-123', email: 'test@example.com' });

      const parts = token.split('.');
      expect(parts).toHaveLength(3);
    });

    it('should produce a JWT with alg=HS256 in the header', () => {
      const realJwtService = new JwtService({
        secret: 'test-secret-min-32-chars-for-hs256-hmac',
        signOptions: { expiresIn: '1h', algorithm: 'HS256' },
      });
      service = new BetterAuthService(realJwtService, mockBaInstance as any);

      const token = service.signJwt({ id: 'user-uuid-123', email: 'test@example.com' });
      const header = JSON.parse(Buffer.from(token.split('.')[0], 'base64url').toString());

      expect(header.alg).toBe('HS256');
    });

    it('should embed sub = user.id in the JWT payload', () => {
      const realJwtService = new JwtService({
        secret: 'test-secret-min-32-chars-for-hs256-hmac',
        signOptions: { expiresIn: '1h', algorithm: 'HS256' },
      });
      service = new BetterAuthService(realJwtService, mockBaInstance as any);

      const token = service.signJwt({ id: 'user-uuid-123', email: 'test@example.com' });
      const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString());

      expect(payload.sub).toBe('user-uuid-123');
    });

    it('should embed email in the JWT payload', () => {
      const realJwtService = new JwtService({
        secret: 'test-secret-min-32-chars-for-hs256-hmac',
        signOptions: { expiresIn: '1h', algorithm: 'HS256' },
      });
      service = new BetterAuthService(realJwtService, mockBaInstance as any);

      const token = service.signJwt({ id: 'user-uuid-123', email: 'test@example.com' });
      const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString());

      expect(payload.email).toBe('test@example.com');
    });

    it('should issue a 1-hour token (exp - iat = 3600)', () => {
      const realJwtService = new JwtService({
        secret: 'test-secret-min-32-chars-for-hs256-hmac',
        signOptions: { expiresIn: '1h', algorithm: 'HS256' },
      });
      service = new BetterAuthService(realJwtService, mockBaInstance as any);

      const before = Math.floor(Date.now() / 1000);
      const token = service.signJwt({ id: 'user-uuid-123', email: 'test@example.com' });
      const after = Math.floor(Date.now() / 1000);

      const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString());
      const duration = payload.exp - payload.iat;

      // Allow a 1-second tolerance for test execution time
      expect(duration).toBeGreaterThanOrEqual(3599);
      expect(duration).toBeLessThanOrEqual(3600);

      // iat should be within the test window
      expect(payload.iat).toBeGreaterThanOrEqual(before);
      expect(payload.iat).toBeLessThanOrEqual(after);
    });
  });

  // ---------------------------------------------------------------------------
  // Helper: build service with mocked JwtService for non-signJwt tests
  // ---------------------------------------------------------------------------

  function buildService() {
    const mockJwtService = {
      sign: jest.fn().mockReturnValue('mocked-sacdia-jwt'),
    } as unknown as JwtService;
    const svc = new BetterAuthService(mockJwtService, mockBaInstance as any);
    return { svc, mockJwtService };
  }

  // ---------------------------------------------------------------------------
  // createUser
  // ---------------------------------------------------------------------------

  describe('createUser', () => {
    it('should return BaAuthResult with user, session, and accessToken on success', async () => {
      const { svc } = buildService();

      mockSignUpEmail.mockResolvedValue({ token: 'raw-opaque-session-token', user: mockUser });
      mockGetSession.mockResolvedValue(mockGetSessionResult);

      const result = await svc.createUser('test@example.com', 'Password123!', 'Test User');

      expect(result).toMatchObject({
        user: expect.objectContaining({ email: 'test@example.com' }),
        session: expect.objectContaining({ token: 'raw-opaque-session-token' }),
        accessToken: 'mocked-sacdia-jwt',
      });
      expect(mockSignUpEmail).toHaveBeenCalledWith({
        body: { email: 'test@example.com', password: 'Password123!', name: 'Test User' },
      });
    });

    it('should throw ConflictException when BA returns 409 (duplicate email)', async () => {
      const { svc } = buildService();

      mockSignUpEmail.mockRejectedValue({
        statusCode: 409,
        status: 'CONFLICT',
        body: { message: 'Email already in use' },
      });

      await expect(
        svc.createUser('test@example.com', 'Password123!', 'Test User'),
      ).rejects.toThrow(ConflictException);
    });

    it('should throw ConflictException when BA returns 422 (unprocessable entity for duplicate)', async () => {
      const { svc } = buildService();

      mockSignUpEmail.mockRejectedValue({
        statusCode: 422,
        status: 'UNPROCESSABLE_ENTITY',
        body: { message: 'Email already registered' },
      });

      await expect(
        svc.createUser('test@example.com', 'Password123!', 'Test User'),
      ).rejects.toThrow(ConflictException);
    });

    it('should throw InternalServerErrorException when BA returns null token', async () => {
      const { svc } = buildService();

      mockSignUpEmail.mockResolvedValue({ token: null, user: mockUser });

      await expect(
        svc.createUser('test@example.com', 'Password123!', 'Test User'),
      ).rejects.toThrow(InternalServerErrorException);
    });

    it('should throw InternalServerErrorException for generic BA errors', async () => {
      const { svc } = buildService();

      mockSignUpEmail.mockRejectedValue({
        statusCode: 500,
        status: 'INTERNAL_SERVER_ERROR',
        body: { message: 'Unexpected error' },
      });

      await expect(
        svc.createUser('test@example.com', 'Password123!', 'Test User'),
      ).rejects.toThrow(InternalServerErrorException);
    });

    it('should throw InternalServerErrorException when BETTER_AUTH_SECRET is not set', async () => {
      const { svc } = buildService();
      delete process.env.BETTER_AUTH_SECRET;

      mockSignUpEmail.mockResolvedValue({ token: 'raw-token', user: mockUser });

      await expect(
        svc.createUser('test@example.com', 'Password123!', 'Test User'),
      ).rejects.toThrow(InternalServerErrorException);
    });
  });

  // ---------------------------------------------------------------------------
  // signInWithPassword
  // ---------------------------------------------------------------------------

  describe('signInWithPassword', () => {
    it('should return BaAuthResult on successful login', async () => {
      const { svc } = buildService();

      mockSignInEmail.mockResolvedValue({ token: 'raw-opaque-session-token', user: mockUser });
      mockGetSession.mockResolvedValue(mockGetSessionResult);

      const result = await svc.signInWithPassword('test@example.com', 'Password123!');

      expect(result).toMatchObject({
        user: expect.objectContaining({ email: 'test@example.com' }),
        session: expect.objectContaining({ token: 'raw-opaque-session-token' }),
        accessToken: 'mocked-sacdia-jwt',
      });
      expect(mockSignInEmail).toHaveBeenCalledWith({
        body: { email: 'test@example.com', password: 'Password123!' },
      });
    });

    it('should throw UnauthorizedException when credentials are invalid (BA 401)', async () => {
      const { svc } = buildService();

      mockSignInEmail.mockRejectedValue({
        statusCode: 401,
        status: 'UNAUTHORIZED',
        body: { message: 'Invalid credentials' },
      });

      await expect(
        svc.signInWithPassword('test@example.com', 'WrongPass!'),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('should rethrow UnauthorizedException thrown by getSessionFromToken', async () => {
      const { svc } = buildService();

      mockSignInEmail.mockResolvedValue({ token: 'raw-token', user: mockUser });
      // Simulate session already expired after sign-in (edge case)
      mockGetSession.mockResolvedValue(null);

      await expect(
        svc.signInWithPassword('test@example.com', 'Password123!'),
      ).rejects.toThrow(UnauthorizedException);
    });
  });

  // ---------------------------------------------------------------------------
  // signOut
  // ---------------------------------------------------------------------------

  describe('signOut', () => {
    it('should complete without error on successful revocation', async () => {
      const { svc } = buildService();

      mockRevokeSession.mockResolvedValue({});

      await expect(svc.signOut('raw-opaque-session-token')).resolves.toBeUndefined();
      expect(mockRevokeSession).toHaveBeenCalledWith(
        expect.objectContaining({ body: { token: 'raw-opaque-session-token' } }),
      );
    });

    it('should NOT throw when revokeSession fails (best-effort)', async () => {
      const { svc } = buildService();

      mockRevokeSession.mockRejectedValue(new Error('Network timeout'));

      // Must not throw — best-effort semantics
      await expect(svc.signOut('raw-opaque-session-token')).resolves.toBeUndefined();
    });

    it('should NOT throw for BA 5xx errors during revocation (best-effort)', async () => {
      const { svc } = buildService();

      mockRevokeSession.mockRejectedValue({
        statusCode: 500,
        status: 'INTERNAL_SERVER_ERROR',
      });

      await expect(svc.signOut('raw-opaque-session-token')).resolves.toBeUndefined();
    });
  });

  // ---------------------------------------------------------------------------
  // refreshSession
  // ---------------------------------------------------------------------------

  describe('refreshSession', () => {
    it('should return a new BaAuthResult with a fresh SACDIA JWT on success', async () => {
      const { svc } = buildService();

      mockGetSession.mockResolvedValue(mockGetSessionResult);

      const result = await svc.refreshSession('raw-opaque-session-token');

      expect(result).toMatchObject({
        user: expect.objectContaining({ email: 'test@example.com' }),
        session: expect.objectContaining({ token: 'raw-opaque-session-token' }),
        accessToken: 'mocked-sacdia-jwt',
      });
    });

    it('should throw UnauthorizedException when session is expired or not found (null result)', async () => {
      const { svc } = buildService();

      mockGetSession.mockResolvedValue(null);

      await expect(svc.refreshSession('expired-session-token')).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('should throw UnauthorizedException when BA returns 401 for getSession', async () => {
      const { svc } = buildService();

      mockGetSession.mockRejectedValue({
        statusCode: 401,
        status: 'UNAUTHORIZED',
        body: { message: 'Session expired' },
      });

      await expect(svc.refreshSession('expired-session-token')).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('should throw InternalServerErrorException when BETTER_AUTH_SECRET is not set', async () => {
      const { svc } = buildService();
      delete process.env.BETTER_AUTH_SECRET;

      await expect(svc.refreshSession('any-token')).rejects.toThrow(
        InternalServerErrorException,
      );
    });
  });

  // ---------------------------------------------------------------------------
  // resetPasswordForEmail
  // ---------------------------------------------------------------------------

  describe('resetPasswordForEmail', () => {
    it('should complete without error on happy path', async () => {
      const { svc } = buildService();

      mockRequestPasswordReset.mockResolvedValue({ status: true });

      await expect(
        svc.resetPasswordForEmail('test@example.com'),
      ).resolves.toBeUndefined();

      expect(mockRequestPasswordReset).toHaveBeenCalledWith({
        body: { email: 'test@example.com' },
      });
    });

    it('should pass redirectTo when provided', async () => {
      const { svc } = buildService();

      mockRequestPasswordReset.mockResolvedValue({ status: true });

      await svc.resetPasswordForEmail('test@example.com', 'https://sacdia.app/reset');

      expect(mockRequestPasswordReset).toHaveBeenCalledWith({
        body: { email: 'test@example.com', redirectTo: 'https://sacdia.app/reset' },
      });
    });

    it('should still complete for unknown emails (enumeration-safe — BA always returns status:true)', async () => {
      const { svc } = buildService();

      // BA returns status:true even for unknown emails
      mockRequestPasswordReset.mockResolvedValue({ status: true });

      await expect(
        svc.resetPasswordForEmail('unknown@example.com'),
      ).resolves.toBeUndefined();
    });

    it('should propagate InternalServerErrorException on unexpected BA errors', async () => {
      const { svc } = buildService();

      mockRequestPasswordReset.mockRejectedValue({
        statusCode: 500,
        status: 'INTERNAL_SERVER_ERROR',
        body: { message: 'Mailer failure' },
      });

      await expect(
        svc.resetPasswordForEmail('test@example.com'),
      ).rejects.toThrow(InternalServerErrorException);
    });
  });
});
