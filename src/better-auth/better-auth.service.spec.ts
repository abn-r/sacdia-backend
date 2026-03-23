import {
  ConflictException,
  InternalServerErrorException,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { BetterAuthService } from './better-auth.service';

/**
 * BetterAuthService unit tests — Option C custom HS256 JWT.
 *
 * BetterAuthService now bypasses BA's adapter for user CRUD and writes directly
 * to Prisma. PrismaService and the BA instance are both mocked. We test the
 * orchestration logic, error mapping, and JWT structure without hitting a real
 * database or BA server.
 */
describe('BetterAuthService', () => {
  // -- Prisma method mocks ---------------------------------------------------
  const mockUsersFindUnique = jest.fn();
  const mockUsersCreate = jest.fn();
  const mockAccountFindFirst = jest.fn();
  const mockAccountCreate = jest.fn();
  const mockAccountUpdate = jest.fn();
  const mockSessionCreate = jest.fn();
  const mockSessionFindFirst = jest.fn();
  const mockSessionDeleteMany = jest.fn();
  const mockSessionUpdate = jest.fn();
  const mockVerificationCreate = jest.fn();

  const mockPrisma = {
    users: {
      findUnique: mockUsersFindUnique,
      create: mockUsersCreate,
    },
    account: {
      findFirst: mockAccountFindFirst,
      create: mockAccountCreate,
      update: mockAccountUpdate,
    },
    session: {
      create: mockSessionCreate,
      findFirst: mockSessionFindFirst,
      deleteMany: mockSessionDeleteMany,
      update: mockSessionUpdate,
    },
    verification: {
      create: mockVerificationCreate,
    },
  };

  // -- BA instance mock (kept for OAuth/TOTP stubs) --------------------------
  const mockBaInstance = {
    api: {
      signInSocial: jest.fn(),
      callbackOAuth: jest.fn(),
    },
  };

  // -- Shared fixtures -------------------------------------------------------
  const mockDbUser = {
    user_id: 'user-uuid-123',
    email: 'test@example.com',
    name: 'Test User',
    email_verified: false,
    user_image: null,
    created_at: new Date('2026-01-01'),
    modified_at: new Date('2026-01-01'),
  };

  const mockDbSession = {
    id: 'session-id-abc',
    userId: 'user-uuid-123',
    token: 'raw-opaque-session-token',
    expiresAt: new Date(Date.now() + 7 * 86400 * 1000),
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
    ipAddress: null,
    userAgent: null,
  };

  const mockDbAccount = {
    id: 'account-id-xyz',
    accountId: 'user-uuid-123',
    providerId: 'credential',
    userId: 'user-uuid-123',
    password: '$2a$12$hashedpassword', // bcrypt hash placeholder
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  // ---------------------------------------------------------------------------
  // signJwt — the core Option C method
  // ---------------------------------------------------------------------------

  describe('signJwt', () => {
    it('should return a valid 3-part JWT string', () => {
      const realJwtService = new JwtService({
        secret: 'test-secret-min-32-chars-for-hs256-hmac',
        signOptions: { expiresIn: '1h', algorithm: 'HS256' },
      });
      const service = new BetterAuthService(
        realJwtService,
        mockPrisma as any,
        mockBaInstance as any,
      );

      const token = service.signJwt({ id: 'user-uuid-123', email: 'test@example.com' });
      const parts = token.split('.');
      expect(parts).toHaveLength(3);
    });

    it('should produce a JWT with alg=HS256 in the header', () => {
      const realJwtService = new JwtService({
        secret: 'test-secret-min-32-chars-for-hs256-hmac',
        signOptions: { expiresIn: '1h', algorithm: 'HS256' },
      });
      const service = new BetterAuthService(
        realJwtService,
        mockPrisma as any,
        mockBaInstance as any,
      );

      const token = service.signJwt({ id: 'user-uuid-123', email: 'test@example.com' });
      const header = JSON.parse(Buffer.from(token.split('.')[0], 'base64url').toString());
      expect(header.alg).toBe('HS256');
    });

    it('should embed sub = user.id in the JWT payload', () => {
      const realJwtService = new JwtService({
        secret: 'test-secret-min-32-chars-for-hs256-hmac',
        signOptions: { expiresIn: '1h', algorithm: 'HS256' },
      });
      const service = new BetterAuthService(
        realJwtService,
        mockPrisma as any,
        mockBaInstance as any,
      );

      const token = service.signJwt({ id: 'user-uuid-123', email: 'test@example.com' });
      const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString());
      expect(payload.sub).toBe('user-uuid-123');
    });

    it('should embed email in the JWT payload', () => {
      const realJwtService = new JwtService({
        secret: 'test-secret-min-32-chars-for-hs256-hmac',
        signOptions: { expiresIn: '1h', algorithm: 'HS256' },
      });
      const service = new BetterAuthService(
        realJwtService,
        mockPrisma as any,
        mockBaInstance as any,
      );

      const token = service.signJwt({ id: 'user-uuid-123', email: 'test@example.com' });
      const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString());
      expect(payload.email).toBe('test@example.com');
    });

    it('should issue a 1-hour token (exp - iat = 3600)', () => {
      const realJwtService = new JwtService({
        secret: 'test-secret-min-32-chars-for-hs256-hmac',
        signOptions: { expiresIn: '1h', algorithm: 'HS256' },
      });
      const service = new BetterAuthService(
        realJwtService,
        mockPrisma as any,
        mockBaInstance as any,
      );

      const before = Math.floor(Date.now() / 1000);
      const token = service.signJwt({ id: 'user-uuid-123', email: 'test@example.com' });
      const after = Math.floor(Date.now() / 1000);

      const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString());
      const duration = payload.exp - payload.iat;

      expect(duration).toBeGreaterThanOrEqual(3599);
      expect(duration).toBeLessThanOrEqual(3600);
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
    const svc = new BetterAuthService(
      mockJwtService,
      mockPrisma as any,
      mockBaInstance as any,
    );
    return { svc, mockJwtService };
  }

  // ---------------------------------------------------------------------------
  // createUser
  // ---------------------------------------------------------------------------

  describe('createUser', () => {
    it('should return BaAuthResult with user, session, and accessToken on success', async () => {
      const { svc } = buildService();

      mockUsersFindUnique.mockResolvedValue(null); // no existing user
      mockUsersCreate.mockResolvedValue(mockDbUser);
      mockAccountCreate.mockResolvedValue(mockDbAccount);
      mockSessionCreate.mockResolvedValue(mockDbSession);

      const result = await svc.createUser('test@example.com', 'Password123!', 'Test User');

      expect(result).toMatchObject({
        user: expect.objectContaining({
          id: 'user-uuid-123',
          email: 'test@example.com',
          name: 'Test User',
          emailVerified: false,
        }),
        session: expect.objectContaining({
          token: 'raw-opaque-session-token',
          userId: 'user-uuid-123',
        }),
        accessToken: 'mocked-sacdia-jwt',
      });
    });

    it('should create the users row with snake_case fields', async () => {
      const { svc } = buildService();

      mockUsersFindUnique.mockResolvedValue(null);
      mockUsersCreate.mockResolvedValue(mockDbUser);
      mockAccountCreate.mockResolvedValue(mockDbAccount);
      mockSessionCreate.mockResolvedValue(mockDbSession);

      await svc.createUser('test@example.com', 'Password123!', 'Test User');

      // Verify prisma.users.create was called with snake_case fields
      expect(mockUsersCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            email: 'test@example.com',
            name: 'Test User',
            email_verified: false,
          }),
        }),
      );
      // Must NOT use camelCase field names
      const createCall = mockUsersCreate.mock.calls[0][0];
      expect(createCall.data).not.toHaveProperty('emailVerified');
      expect(createCall.data).not.toHaveProperty('id');
    });

    it('should create the account row with credential providerId', async () => {
      const { svc } = buildService();

      mockUsersFindUnique.mockResolvedValue(null);
      mockUsersCreate.mockResolvedValue(mockDbUser);
      mockAccountCreate.mockResolvedValue(mockDbAccount);
      mockSessionCreate.mockResolvedValue(mockDbSession);

      await svc.createUser('test@example.com', 'Password123!', 'Test User');

      expect(mockAccountCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            providerId: 'credential',
            // userId is a randomUUID generated at runtime — just verify it's a string
            userId: expect.any(String),
            password: expect.stringMatching(/^\$2[ab]\$12\$/), // bcrypt format
          }),
        }),
      );
    });

    it('should throw ConflictException when email is already in use', async () => {
      const { svc } = buildService();

      mockUsersFindUnique.mockResolvedValue(mockDbUser); // existing user

      await expect(
        svc.createUser('test@example.com', 'Password123!', 'Test User'),
      ).rejects.toThrow(ConflictException);

      expect(mockUsersCreate).not.toHaveBeenCalled();
    });
  });

  // ---------------------------------------------------------------------------
  // signInWithPassword
  // ---------------------------------------------------------------------------

  describe('signInWithPassword', () => {
    it('should return BaAuthResult on successful login', async () => {
      const { svc } = buildService();

      // Use a real bcrypt hash for the password check
      const bcrypt = require('bcryptjs');
      const realHash = await bcrypt.hash('Password123!', 12);
      const accountWithRealHash = { ...mockDbAccount, password: realHash };

      mockUsersFindUnique.mockResolvedValue(mockDbUser);
      mockAccountFindFirst.mockResolvedValue(accountWithRealHash);
      mockSessionCreate.mockResolvedValue(mockDbSession);

      const result = await svc.signInWithPassword('test@example.com', 'Password123!');

      expect(result).toMatchObject({
        user: expect.objectContaining({ email: 'test@example.com' }),
        session: expect.objectContaining({ token: 'raw-opaque-session-token' }),
        accessToken: 'mocked-sacdia-jwt',
      });
    });

    it('should throw UnauthorizedException when user is not found', async () => {
      const { svc } = buildService();

      mockUsersFindUnique.mockResolvedValue(null);

      await expect(
        svc.signInWithPassword('unknown@example.com', 'Password123!'),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('should throw UnauthorizedException when account is not found', async () => {
      const { svc } = buildService();

      mockUsersFindUnique.mockResolvedValue(mockDbUser);
      mockAccountFindFirst.mockResolvedValue(null);

      await expect(
        svc.signInWithPassword('test@example.com', 'Password123!'),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('should throw UnauthorizedException when password is wrong', async () => {
      const { svc } = buildService();

      const bcrypt = require('bcryptjs');
      const realHash = await bcrypt.hash('CorrectPassword!', 12);
      const accountWithRealHash = { ...mockDbAccount, password: realHash };

      mockUsersFindUnique.mockResolvedValue(mockDbUser);
      mockAccountFindFirst.mockResolvedValue(accountWithRealHash);

      await expect(
        svc.signInWithPassword('test@example.com', 'WrongPassword!'),
      ).rejects.toThrow(UnauthorizedException);
    });
  });

  // ---------------------------------------------------------------------------
  // signOut
  // ---------------------------------------------------------------------------

  describe('signOut', () => {
    it('should delete the session on successful sign-out', async () => {
      const { svc } = buildService();

      mockSessionDeleteMany.mockResolvedValue({ count: 1 });

      await expect(svc.signOut('raw-opaque-session-token')).resolves.toBeUndefined();
      expect(mockSessionDeleteMany).toHaveBeenCalledWith({
        where: { token: 'raw-opaque-session-token' },
      });
    });

    it('should NOT throw when session deletion fails (best-effort)', async () => {
      const { svc } = buildService();

      mockSessionDeleteMany.mockRejectedValue(new Error('DB connection lost'));

      await expect(svc.signOut('raw-opaque-session-token')).resolves.toBeUndefined();
    });
  });

  // ---------------------------------------------------------------------------
  // refreshSession
  // ---------------------------------------------------------------------------

  describe('refreshSession', () => {
    it('should return a new BaAuthResult with a fresh SACDIA JWT on success', async () => {
      const { svc } = buildService();

      const futureExpiry = new Date(Date.now() + 7 * 86400 * 1000);
      const validSession = { ...mockDbSession, expiresAt: futureExpiry };
      mockSessionFindFirst.mockResolvedValue(validSession);
      mockSessionUpdate.mockResolvedValue({ ...validSession, expiresAt: new Date(Date.now() + 7 * 86400 * 1000) });
      mockUsersFindUnique.mockResolvedValue(mockDbUser);

      const result = await svc.refreshSession('raw-opaque-session-token');

      expect(result).toMatchObject({
        user: expect.objectContaining({ email: 'test@example.com' }),
        session: expect.objectContaining({ userId: 'user-uuid-123' }),
        accessToken: 'mocked-sacdia-jwt',
      });
    });

    it('should throw UnauthorizedException when session is not found', async () => {
      const { svc } = buildService();

      mockSessionFindFirst.mockResolvedValue(null);

      await expect(svc.refreshSession('non-existent-token')).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('should throw UnauthorizedException and delete the session when it is expired', async () => {
      const { svc } = buildService();

      const expiredSession = {
        ...mockDbSession,
        expiresAt: new Date(Date.now() - 1000), // 1 second ago
      };
      mockSessionFindFirst.mockResolvedValue(expiredSession);
      mockSessionDeleteMany.mockResolvedValue({ count: 1 });

      await expect(svc.refreshSession('expired-session-token')).rejects.toThrow(
        UnauthorizedException,
      );
      expect(mockSessionDeleteMany).toHaveBeenCalledWith({
        where: { token: 'expired-session-token' },
      });
    });

    it('should throw InternalServerErrorException when user is not found for a valid session', async () => {
      const { svc } = buildService();

      const futureExpiry = new Date(Date.now() + 7 * 86400 * 1000);
      mockSessionFindFirst.mockResolvedValue({ ...mockDbSession, expiresAt: futureExpiry });
      mockSessionUpdate.mockResolvedValue({ ...mockDbSession, expiresAt: futureExpiry });
      mockUsersFindUnique.mockResolvedValue(null); // user deleted

      await expect(svc.refreshSession('raw-opaque-session-token')).rejects.toThrow(
        InternalServerErrorException,
      );
    });
  });

  // ---------------------------------------------------------------------------
  // resetPasswordForEmail
  // ---------------------------------------------------------------------------

  describe('resetPasswordForEmail', () => {
    it('should create a verification token when email exists', async () => {
      const { svc } = buildService();

      mockUsersFindUnique.mockResolvedValue(mockDbUser);
      mockVerificationCreate.mockResolvedValue({});

      await expect(
        svc.resetPasswordForEmail('test@example.com'),
      ).resolves.toBeUndefined();

      expect(mockVerificationCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            identifier: 'test@example.com',
            value: expect.any(String),
            expiresAt: expect.any(Date),
          }),
        }),
      );
    });

    it('should complete silently for unknown emails (enumeration-safe)', async () => {
      const { svc } = buildService();

      mockUsersFindUnique.mockResolvedValue(null);

      await expect(
        svc.resetPasswordForEmail('unknown@example.com'),
      ).resolves.toBeUndefined();

      expect(mockVerificationCreate).not.toHaveBeenCalled();
    });
  });

  // ---------------------------------------------------------------------------
  // updatePasswordById
  // ---------------------------------------------------------------------------

  describe('updatePasswordById', () => {
    it('should update the hashed password on the credential account', async () => {
      const { svc } = buildService();

      mockAccountFindFirst.mockResolvedValue(mockDbAccount);
      mockAccountUpdate.mockResolvedValue({});

      await expect(
        svc.updatePasswordById('user-uuid-123', 'NewPassword123!'),
      ).resolves.toBeUndefined();

      expect(mockAccountUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: mockDbAccount.id },
          data: expect.objectContaining({
            password: expect.stringMatching(/^\$2[ab]\$12\$/),
          }),
        }),
      );
    });

    it('should throw NotFoundException when no credential account exists', async () => {
      const { svc } = buildService();

      mockAccountFindFirst.mockResolvedValue(null);

      await expect(
        svc.updatePasswordById('user-uuid-123', 'NewPassword123!'),
      ).rejects.toThrow(NotFoundException);
    });
  });
});
