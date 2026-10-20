import { ServiceUnavailableException } from '@nestjs/common';
import { ErrorCode } from '../common/errors/error-codes';
import { JwtService } from '@nestjs/jwt';
import { BetterAuthService, DUMMY_BCRYPT_HASH } from './better-auth.service';

const mockSupervisedResolver = {
  resolve: jest.fn(),
};

const mockFamilyFlags = {
  isEnabled: jest.fn(),
};

const mockEmailService = {
  sendDataExportReady: jest.fn().mockResolvedValue(undefined),
  sendEmailVerification: jest.fn().mockResolvedValue(undefined),
  sendPasswordReset: jest.fn().mockResolvedValue(undefined),
  sendAccountDeletionConfirmed: jest.fn().mockResolvedValue(undefined),
  enqueue: jest.fn().mockResolvedValue(undefined),
};

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
  const mockSupervisedLoginsFindFirst = jest.fn();
  const mockAccountFindFirst = jest.fn();
  const mockAccountCreate = jest.fn();
  const mockAccountUpdate = jest.fn();
  const mockSessionCreate = jest.fn();
  const mockSessionFindFirst = jest.fn();
  const mockSessionDeleteMany = jest.fn();
  const mockSessionUpdate = jest.fn();
  const mockVerificationCreate = jest.fn();
  const mockVerificationFindFirst = jest.fn();
  const mockVerificationDelete = jest.fn();
  const mockVerificationDeleteMany = jest.fn();
  const mockQueryRaw = jest.fn();
  const mockTransaction = jest.fn();

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
      findFirst: mockVerificationFindFirst,
      delete: mockVerificationDelete,
      deleteMany: mockVerificationDeleteMany,
    },
    supervised_logins: {
      findFirst: mockSupervisedLoginsFindFirst,
    },
    $queryRaw: mockQueryRaw,
    $transaction: mockTransaction,
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
    // Default: no TOTP enrolled — hasTotpEnabled returns null → mfa_pending: false
    mockVerificationFindFirst.mockResolvedValue(null);
    mockSupervisedResolver.resolve.mockReset().mockResolvedValue({
      state: 'adult',
    });
    mockFamilyFlags.isEnabled.mockReset().mockReturnValue(true);
  });

  // ---------------------------------------------------------------------------
  // signJwt — the core Option C method
  // ---------------------------------------------------------------------------

  describe('signJwt', () => {
    it('should return a valid 3-part JWT string', () => {
      const realJwtService = new JwtService({
        secret: 'test-secret-min-32-chars-for-hs256-hmac',
        signOptions: { expiresIn: '8h', algorithm: 'HS256' },
      });
      const service = new BetterAuthService(
        realJwtService,
        mockPrisma as any,
        mockEmailService as any,
        mockSupervisedResolver as any,
        mockFamilyFlags as any,
      );

      const token = service.signJwt({
        id: 'user-uuid-123',
        email: 'test@example.com',
      });
      const parts = token.split('.');
      expect(parts).toHaveLength(3);
    });

    it('should produce a JWT with alg=HS256 in the header', () => {
      const realJwtService = new JwtService({
        secret: 'test-secret-min-32-chars-for-hs256-hmac',
        signOptions: { expiresIn: '8h', algorithm: 'HS256' },
      });
      const service = new BetterAuthService(
        realJwtService,
        mockPrisma as any,
        mockEmailService as any,
        mockSupervisedResolver as any,
        mockFamilyFlags as any,
      );

      const token = service.signJwt({
        id: 'user-uuid-123',
        email: 'test@example.com',
      });
      const header = JSON.parse(
        Buffer.from(token.split('.')[0], 'base64url').toString(),
      );
      expect(header.alg).toBe('HS256');
    });

    it('should embed sub = user.id in the JWT payload', () => {
      const realJwtService = new JwtService({
        secret: 'test-secret-min-32-chars-for-hs256-hmac',
        signOptions: { expiresIn: '8h', algorithm: 'HS256' },
      });
      const service = new BetterAuthService(
        realJwtService,
        mockPrisma as any,
        mockEmailService as any,
        mockSupervisedResolver as any,
        mockFamilyFlags as any,
      );

      const token = service.signJwt({
        id: 'user-uuid-123',
        email: 'test@example.com',
      });
      const payload = JSON.parse(
        Buffer.from(token.split('.')[1], 'base64url').toString(),
      );
      expect(payload.sub).toBe('user-uuid-123');
      expect(payload.iss).toBe('https://api.sacdia.app');
      expect(payload.aud).toBe('sacdia:access');
    });

    it('should embed email in the JWT payload', () => {
      const realJwtService = new JwtService({
        secret: 'test-secret-min-32-chars-for-hs256-hmac',
        signOptions: { expiresIn: '8h', algorithm: 'HS256' },
      });
      const service = new BetterAuthService(
        realJwtService,
        mockPrisma as any,
        mockEmailService as any,
        mockSupervisedResolver as any,
        mockFamilyFlags as any,
      );

      const token = service.signJwt({
        id: 'user-uuid-123',
        email: 'test@example.com',
      });
      const payload = JSON.parse(
        Buffer.from(token.split('.')[1], 'base64url').toString(),
      );
      expect(payload.email).toBe('test@example.com');
    });

    it('should issue an 8-hour token (exp - iat = 28800)', () => {
      const realJwtService = new JwtService({
        secret: 'test-secret-min-32-chars-for-hs256-hmac',
        signOptions: { expiresIn: '8h', algorithm: 'HS256' },
      });
      const service = new BetterAuthService(
        realJwtService,
        mockPrisma as any,
        mockEmailService as any,
        mockSupervisedResolver as any,
        mockFamilyFlags as any,
      );

      const before = Math.floor(Date.now() / 1000);
      const token = service.signJwt({
        id: 'user-uuid-123',
        email: 'test@example.com',
      });
      const after = Math.floor(Date.now() / 1000);

      const payload = JSON.parse(
        Buffer.from(token.split('.')[1], 'base64url').toString(),
      );
      const duration = payload.exp - payload.iat;

      expect(duration).toBeGreaterThanOrEqual(28799);
      expect(duration).toBeLessThanOrEqual(28800);
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
      mockEmailService as any,
      mockSupervisedResolver as any,
      mockFamilyFlags as any,
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

      const result = await svc.createUser(
        'test@example.com',
        'Password123!',
        'Test User',
      );

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

    it('does not reveal that the email is already registered', async () => {
      const { svc } = buildService();

      mockUsersFindUnique.mockResolvedValue(mockDbUser);

      await expect(
        svc.createUser('test@example.com', 'Password123!', 'Test User'),
      ).rejects.toMatchObject({ code: ErrorCode.AUTH_INVALID_CREDENTIALS });

      expect(mockUsersCreate).not.toHaveBeenCalled();
    });

    it('maps a unique-email race to the same login-generic error', async () => {
      const { svc } = buildService();
      mockUsersFindUnique.mockResolvedValue(null);
      const conflict = Object.assign(new Error('Unique constraint failed'), {
        code: 'P2002',
      });
      mockUsersCreate.mockRejectedValue(conflict);

      await expect(
        svc.createUser('test@example.com', 'Password123!', 'Test User'),
      ).rejects.toMatchObject({ code: ErrorCode.AUTH_INVALID_CREDENTIALS });
    });
  });

  // ---------------------------------------------------------------------------
  // signInWithPassword
  // ---------------------------------------------------------------------------

  describe('signInWithIdentifier (email login)', () => {
    it('should return BaAuthResult on successful login', async () => {
      const { svc } = buildService();

      // Use a real bcrypt hash for the password check
      const bcrypt = require('bcryptjs');
      const realHash = await bcrypt.hash('Password123!', 12);
      const accountWithRealHash = { ...mockDbAccount, password: realHash };

      mockUsersFindUnique.mockResolvedValue(mockDbUser);
      mockAccountFindFirst.mockResolvedValue(accountWithRealHash);
      mockSessionCreate.mockResolvedValue(mockDbSession);

      const result = await svc.signInWithIdentifier(
        'test@example.com',
        'Password123!',
      );

      expect(result).toMatchObject({
        user: expect.objectContaining({ email: 'test@example.com' }),
        session: expect.objectContaining({ token: 'raw-opaque-session-token' }),
        accessToken: 'mocked-sacdia-jwt',
      });
      expect(mockSessionCreate).toHaveBeenCalledWith({
        data: expect.objectContaining({ ipAddress: null, userAgent: null }),
      });
    });

    it('should persist the request IP and User-Agent on the session row', async () => {
      const { svc } = buildService();

      const bcrypt = require('bcryptjs');
      const realHash = await bcrypt.hash('Password123!', 12);

      mockUsersFindUnique.mockResolvedValue(mockDbUser);
      mockAccountFindFirst.mockResolvedValue({
        ...mockDbAccount,
        password: realHash,
      });
      mockSessionCreate.mockResolvedValue(mockDbSession);

      await svc.signInWithIdentifier('test@example.com', 'Password123!', {
        ipAddress: '203.0.113.7',
        userAgent: 'Dart/3.11 (dart:io)',
      });

      expect(mockSessionCreate).toHaveBeenCalledWith({
        data: expect.objectContaining({
          userId: mockDbUser.user_id,
          ipAddress: '203.0.113.7',
          userAgent: 'Dart/3.11 (dart:io)',
        }),
      });
    });

    it('should throw UnauthorizedException when user is not found', async () => {
      const { svc } = buildService();

      mockUsersFindUnique.mockResolvedValue(null);

      await expect(
        svc.signInWithIdentifier('unknown@example.com', 'Password123!'),
      ).rejects.toMatchObject({ code: ErrorCode.AUTH_INVALID_CREDENTIALS });
    });

    it('should throw UnauthorizedException when account is not found', async () => {
      const { svc } = buildService();

      mockUsersFindUnique.mockResolvedValue(mockDbUser);
      mockAccountFindFirst.mockResolvedValue(null);

      await expect(
        svc.signInWithIdentifier('test@example.com', 'Password123!'),
      ).rejects.toMatchObject({ code: ErrorCode.AUTH_INVALID_CREDENTIALS });
    });

    it('should throw UnauthorizedException when password is wrong', async () => {
      const { svc } = buildService();

      const bcrypt = require('bcryptjs');
      const realHash = await bcrypt.hash('CorrectPassword!', 12);
      const accountWithRealHash = { ...mockDbAccount, password: realHash };

      mockUsersFindUnique.mockResolvedValue(mockDbUser);
      mockAccountFindFirst.mockResolvedValue(accountWithRealHash);

      await expect(
        svc.signInWithIdentifier('test@example.com', 'WrongPassword!'),
      ).rejects.toMatchObject({ code: ErrorCode.AUTH_INVALID_CREDENTIALS });
    });
  });

  // ---------------------------------------------------------------------------
  // signInWithIdentifier: handles, uniform timing, blocked states (phase 3a)
  // ---------------------------------------------------------------------------

  describe('signInWithIdentifier (handles and uniform failures)', () => {
    const bcrypt = require('bcryptjs');
    const HANDLE = 'ana-7kq4m9tx';
    const handleUser = { ...mockDbUser, user_id: 'teen-uuid-1', email: null };

    async function realAccount(password = 'Password123!') {
      return {
        ...mockDbAccount,
        userId: handleUser.user_id,
        password: await bcrypt.hash(password, 12),
      };
    }

    afterEach(() => jest.restoreAllMocks());

    it('logs a handle teen in (the handle resolves through supervised_logins)', async () => {
      const { svc } = buildService();
      mockSupervisedLoginsFindFirst.mockResolvedValue({ user: handleUser });
      mockAccountFindFirst.mockResolvedValue(await realAccount());
      mockSessionCreate.mockResolvedValue(mockDbSession);

      const result = await svc.signInWithIdentifier(HANDLE, 'Password123!');

      expect(result.user.id).toBe('teen-uuid-1');
      expect(mockUsersFindUnique).not.toHaveBeenCalled();
      expect(mockSupervisedLoginsFindFirst).toHaveBeenCalledWith({
        where: { login_handle: HANDLE },
        select: { user: true },
      });
    });

    it('is case-insensitive and trims the handle', async () => {
      const { svc } = buildService();
      mockSupervisedLoginsFindFirst.mockResolvedValue({ user: handleUser });
      mockAccountFindFirst.mockResolvedValue(await realAccount());
      mockSessionCreate.mockResolvedValue(mockDbSession);

      await svc.signInWithIdentifier('  Ana-7KQ4M9TX ', 'Password123!');

      expect(mockSupervisedLoginsFindFirst).toHaveBeenCalledWith({
        where: { login_handle: HANDLE },
        select: { user: true },
      });
    });

    it('treats an identifier with "@" as an email, never as a handle', async () => {
      const { svc } = buildService();
      mockUsersFindUnique.mockResolvedValue(mockDbUser);
      mockAccountFindFirst.mockResolvedValue(await realAccount());
      mockSessionCreate.mockResolvedValue(mockDbSession);

      await svc.signInWithIdentifier('test@example.com', 'Password123!');

      expect(mockUsersFindUnique).toHaveBeenCalledWith({
        where: { email: 'test@example.com' },
      });
      expect(mockSupervisedLoginsFindFirst).not.toHaveBeenCalled();
    });

    describe('uniform failure and timing', () => {
      it.each([
        ['an unknown email', 'nobody@example.com'],
        ['an unknown handle', 'nobody-xx99zz'],
        ['a malformed handle', 'x'],
      ])(
        'runs a dummy bcrypt comparison and answers the uniform 401 for %s',
        async (_label, identifier) => {
          const { svc } = buildService();
          mockUsersFindUnique.mockResolvedValue(null);
          mockSupervisedLoginsFindFirst.mockResolvedValue(null);
          const compare = jest.spyOn(bcrypt, 'compare');

          await expect(
            svc.signInWithIdentifier(identifier, 'Password123!'),
          ).rejects.toMatchObject({
            code: ErrorCode.AUTH_INVALID_CREDENTIALS,
            status: 401,
          });

          expect(compare).toHaveBeenCalledTimes(1);
          expect(compare).toHaveBeenCalledWith(
            'Password123!',
            DUMMY_BCRYPT_HASH,
          );
          expect(mockSessionCreate).not.toHaveBeenCalled();
        },
      );

      it.each([
        ['an email', 'nobody@example.com', 'test@example.com'],
        ['a handle', 'nobody-xx99zz', HANDLE],
      ])(
        'an unknown %s makes the SAME lookups as a wrong password (no DB round-trip skipped, QA BUG-6)',
        async (_label, unknown, known) => {
          // Timing parity: the unknown path used to skip the credential lookup,
          // ~1 DB round-trip (~68 ms on Neon) faster than a wrong password.
          const lookups = () => ({
            users: mockUsersFindUnique.mock.calls.length,
            handles: mockSupervisedLoginsFindFirst.mock.calls.length,
            accounts: mockAccountFindFirst.mock.calls.length,
          });
          const { svc } = buildService();
          // Only the lookups matter here: no real cost-12 hashing (CPU-bound,
          // it times out under a loaded full run). The dummy compare itself is
          // covered by the tests around this one.
          const compare = jest
            .spyOn(bcrypt, 'compare')
            .mockResolvedValue(false);

          mockUsersFindUnique.mockResolvedValue(mockDbUser);
          mockSupervisedLoginsFindFirst.mockResolvedValue({ user: handleUser });
          mockAccountFindFirst.mockResolvedValue({
            ...mockDbAccount,
            userId: handleUser.user_id,
            password: '$2b$12$not-a-real-hash-only-a-non-empty-value',
          });
          await expect(
            svc.signInWithIdentifier(known, 'WrongPassword1!'),
          ).rejects.toMatchObject({ code: ErrorCode.AUTH_INVALID_CREDENTIALS });
          const wrongPassword = lookups();

          jest.clearAllMocks();
          mockUsersFindUnique.mockResolvedValue(null);
          mockSupervisedLoginsFindFirst.mockResolvedValue(null);
          mockAccountFindFirst.mockResolvedValue(null);
          await expect(
            svc.signInWithIdentifier(unknown, 'WrongPassword1!'),
          ).rejects.toMatchObject({ code: ErrorCode.AUTH_INVALID_CREDENTIALS });

          expect(lookups()).toEqual(wrongPassword);
          expect(mockAccountFindFirst).toHaveBeenCalledWith({
            where: {
              userId: '00000000-0000-0000-0000-000000000000',
              providerId: 'credential',
            },
          });
          expect(compare).toHaveBeenCalledTimes(1);
          expect(compare).toHaveBeenCalledWith(
            'WrongPassword1!',
            DUMMY_BCRYPT_HASH,
          );
        },
      );

      it('runs the dummy comparison when the user has no credential (email and handle)', async () => {
        const { svc } = buildService();
        mockUsersFindUnique.mockResolvedValue(mockDbUser);
        mockSupervisedLoginsFindFirst.mockResolvedValue({ user: handleUser });
        mockAccountFindFirst.mockResolvedValue(null);
        const compare = jest.spyOn(bcrypt, 'compare');

        for (const identifier of ['test@example.com', HANDLE]) {
          compare.mockClear();
          await expect(
            svc.signInWithIdentifier(identifier, 'Password123!'),
          ).rejects.toMatchObject({ code: ErrorCode.AUTH_INVALID_CREDENTIALS });
          expect(compare).toHaveBeenCalledTimes(1);
          expect(compare).toHaveBeenCalledWith(
            'Password123!',
            DUMMY_BCRYPT_HASH,
          );
        }
      });

      it('also runs the dummy comparison for an account with an empty password hash', async () => {
        const { svc } = buildService();
        mockUsersFindUnique.mockResolvedValue(mockDbUser);
        mockAccountFindFirst.mockResolvedValue({
          ...mockDbAccount,
          password: null,
        });
        const compare = jest.spyOn(bcrypt, 'compare');

        await expect(
          svc.signInWithIdentifier('test@example.com', 'x'),
        ).rejects.toMatchObject({ code: ErrorCode.AUTH_INVALID_CREDENTIALS });
        expect(compare).toHaveBeenCalledWith('x', DUMMY_BCRYPT_HASH);
      });

      it('answers byte-identical errors for an unknown handle, a known handle with a wrong password and a missing credential', async () => {
        const { svc } = buildService();
        const wrongHash = await realAccount('CorrectPassword!');
        const outcomes: string[] = [];
        const capture = async () => {
          try {
            await svc.signInWithIdentifier(HANDLE, 'WrongPassword!');
            return 'no-error';
          } catch (error) {
            const e = error as {
              code: string;
              status: number;
              getResponse: () => unknown;
            };
            return JSON.stringify({
              code: e.code,
              status: e.status,
              response: e.getResponse(),
            });
          }
        };

        mockSupervisedLoginsFindFirst.mockResolvedValue(null);
        outcomes.push(await capture()); // unknown handle

        mockSupervisedLoginsFindFirst.mockResolvedValue({ user: handleUser });
        mockAccountFindFirst.mockResolvedValue(wrongHash);
        outcomes.push(await capture()); // wrong password

        mockAccountFindFirst.mockResolvedValue(null);
        outcomes.push(await capture()); // no credential

        expect(new Set(outcomes).size).toBe(1);
        expect(JSON.parse(outcomes[0])).toMatchObject({
          code: 'AUTH_INVALID_CREDENTIALS',
          status: 401,
        });
      });

      it('with FAMILY_TEEN_LOGIN_ENABLED off a handle is the uniform 401 even with the right password (and a dummy compare)', async () => {
        const { svc } = buildService();
        mockFamilyFlags.isEnabled.mockReturnValue(false);
        mockSupervisedLoginsFindFirst.mockResolvedValue({ user: handleUser });
        mockAccountFindFirst.mockResolvedValue(await realAccount());
        const compare = jest.spyOn(bcrypt, 'compare');

        await expect(
          svc.signInWithIdentifier(HANDLE, 'Password123!'),
        ).rejects.toMatchObject({
          code: ErrorCode.AUTH_INVALID_CREDENTIALS,
          status: 401,
        });

        expect(mockFamilyFlags.isEnabled).toHaveBeenCalledWith('teen_login');
        expect(mockSupervisedLoginsFindFirst).not.toHaveBeenCalled();
        expect(compare).toHaveBeenCalledWith('Password123!', DUMMY_BCRYPT_HASH);
      });

      it('with the flag off an EMAIL teen still logs in', async () => {
        const { svc } = buildService();
        mockFamilyFlags.isEnabled.mockReturnValue(false);
        mockUsersFindUnique.mockResolvedValue(mockDbUser);
        mockAccountFindFirst.mockResolvedValue(await realAccount());
        mockSessionCreate.mockResolvedValue(mockDbSession);

        await expect(
          svc.signInWithIdentifier('test@example.com', 'Password123!'),
        ).resolves.toMatchObject({ accessToken: 'mocked-sacdia-jwt' });
      });

      it('the dummy hash is a valid bcrypt hash at the same cost as real ones', () => {
        expect(DUMMY_BCRYPT_HASH).toMatch(/^\$2[aby]\$12\$[./A-Za-z0-9]{53}$/);
        expect(bcrypt.getRounds(DUMMY_BCRYPT_HASH)).toBe(12);
      });
    });

    describe('blocked states are revealed only AFTER a correct password', () => {
      it('a disabled supervised login answers 403 AUTH_SUPERVISED_LOGIN_DISABLED with the right password', async () => {
        const { svc } = buildService();
        mockSupervisedLoginsFindFirst.mockResolvedValue({ user: handleUser });
        mockAccountFindFirst.mockResolvedValue(await realAccount());
        mockSupervisedResolver.resolve.mockResolvedValue({
          state: 'blocked',
          cause: 'login_disabled',
        });

        await expect(
          svc.signInWithIdentifier(HANDLE, 'Password123!'),
        ).rejects.toMatchObject({
          code: ErrorCode.AUTH_SUPERVISED_LOGIN_DISABLED,
          status: 403,
        });
        expect(mockSessionCreate).not.toHaveBeenCalled();
      });

      it('a frozen account answers 403 AUTH_ACCOUNT_FROZEN with the right password', async () => {
        const { svc } = buildService();
        mockSupervisedLoginsFindFirst.mockResolvedValue({ user: handleUser });
        mockAccountFindFirst.mockResolvedValue(await realAccount());
        mockSupervisedResolver.resolve.mockResolvedValue({
          state: 'blocked',
          cause: 'frozen',
        });

        await expect(
          svc.signInWithIdentifier(HANDLE, 'Password123!'),
        ).rejects.toMatchObject({
          code: ErrorCode.AUTH_ACCOUNT_FROZEN,
          status: 403,
        });
      });

      it.each(['login_disabled', 'frozen'])(
        'a WRONG password on a %s account is still the uniform 401 (nothing is revealed) and the state is not even read',
        async (cause) => {
          const { svc } = buildService();
          mockSupervisedLoginsFindFirst.mockResolvedValue({ user: handleUser });
          mockAccountFindFirst.mockResolvedValue(await realAccount());
          mockSupervisedResolver.resolve.mockResolvedValue({
            state: 'blocked',
            cause,
          });

          await expect(
            svc.signInWithIdentifier(HANDLE, 'WrongPassword!'),
          ).rejects.toMatchObject({
            code: ErrorCode.AUTH_INVALID_CREDENTIALS,
            status: 401,
          });
          expect(mockSupervisedResolver.resolve).not.toHaveBeenCalled();
        },
      );

      it('a teen who reached the age of majority keeps logging in (the resolver says adult)', async () => {
        const { svc } = buildService();
        mockSupervisedLoginsFindFirst.mockResolvedValue({ user: handleUser });
        mockAccountFindFirst.mockResolvedValue(await realAccount());
        mockSupervisedResolver.resolve.mockResolvedValue({ state: 'adult' });
        mockSessionCreate.mockResolvedValue(mockDbSession);

        await expect(
          svc.signInWithIdentifier(HANDLE, 'Password123!'),
        ).resolves.toMatchObject({ accessToken: 'mocked-sacdia-jwt' });
      });

      it('email logins of an adult never see a blocked state', async () => {
        const { svc } = buildService();
        mockUsersFindUnique.mockResolvedValue(mockDbUser);
        mockAccountFindFirst.mockResolvedValue(await realAccount());
        mockSessionCreate.mockResolvedValue(mockDbSession);

        await svc.signInWithIdentifier('test@example.com', 'Password123!');

        expect(mockSupervisedResolver.resolve).toHaveBeenCalledWith(
          mockDbUser.user_id,
        );
      });
    });

    it('keeps the deprecated signInWithPassword alias working (email)', async () => {
      const { svc } = buildService();
      mockUsersFindUnique.mockResolvedValue(mockDbUser);
      mockAccountFindFirst.mockResolvedValue(await realAccount());
      mockSessionCreate.mockResolvedValue(mockDbSession);

      await expect(
        svc.signInWithPassword('test@example.com', 'Password123!'),
      ).resolves.toMatchObject({ accessToken: 'mocked-sacdia-jwt' });
    });
  });

  // ---------------------------------------------------------------------------
  // signOut
  // ---------------------------------------------------------------------------

  describe('signOut', () => {
    it('should delete the session on successful sign-out', async () => {
      const { svc } = buildService();

      mockSessionDeleteMany.mockResolvedValue({ count: 1 });

      await expect(
        svc.signOut('raw-opaque-session-token'),
      ).resolves.toBeUndefined();
      expect(mockSessionDeleteMany).toHaveBeenCalledWith({
        where: { token: 'raw-opaque-session-token' },
      });
    });

    it('should NOT throw when session deletion fails (best-effort)', async () => {
      const { svc } = buildService();

      mockSessionDeleteMany.mockRejectedValue(new Error('DB connection lost'));

      await expect(
        svc.signOut('raw-opaque-session-token'),
      ).resolves.toBeUndefined();
    });
  });

  // ---------------------------------------------------------------------------
  // refreshSession
  // ---------------------------------------------------------------------------

  /**
   * Shared fixture that matches the RefreshRow type returned by $queryRaw.
   * All fields use snake_case as Postgres returns them.
   * User columns are prefixed with u_ to avoid collision with session columns.
   */
  const mockRefreshRow = {
    // session fields
    id: 'session-id-abc',
    token: 'raw-opaque-session-token',
    expires_at: new Date(Date.now() + 7 * 86400 * 1000),
    created_at: new Date('2026-01-01'),
    updated_at: new Date('2026-01-01'),
    ip_address: null,
    user_agent: null,
    user_id: 'user-uuid-123',
    // user fields (u_ prefix)
    u_user_id: 'user-uuid-123',
    u_email: 'test@example.com',
    u_name: 'Test User',
    u_email_verified: false,
    u_user_image: null,
    u_created_at: new Date('2026-01-01'),
    u_modified_at: new Date('2026-01-01'),
  };

  describe('refreshSession', () => {
    it('should return a new BaAuthResult with a fresh SACDIA JWT on success', async () => {
      const { svc } = buildService();

      mockQueryRaw.mockResolvedValue([mockRefreshRow]);

      const result = await svc.refreshSession('raw-opaque-session-token');

      expect(result).toMatchObject({
        user: expect.objectContaining({ email: 'test@example.com' }),
        session: expect.objectContaining({ userId: 'user-uuid-123' }),
        accessToken: 'mocked-sacdia-jwt',
      });
      expect(mockQueryRaw).toHaveBeenCalledTimes(1);
    });

    it('should issue aal2 when TOTP is enrolled and session assurance is valid', async () => {
      const { svc, mockJwtService } = buildService();

      mockQueryRaw.mockResolvedValue([mockRefreshRow]);
      mockVerificationFindFirst
        .mockResolvedValueOnce({ id: 'totp-record-id' })
        .mockResolvedValueOnce({ id: 'mfa-session-assurance-id' });

      await svc.refreshSession('raw-opaque-session-token');

      expect(mockJwtService.sign).toHaveBeenCalledWith(
        expect.objectContaining({
          sub: 'user-uuid-123',
          email: 'test@example.com',
          sid: 'session-id-abc',
        }),
      );
      expect(mockJwtService.sign).toHaveBeenCalledWith(
        expect.not.objectContaining({ mfa_pending: true }),
      );
    });

    it('should issue aal1 mfa_pending when TOTP is enrolled but session assurance is missing', async () => {
      const { svc, mockJwtService } = buildService();

      mockQueryRaw.mockResolvedValue([mockRefreshRow]);
      mockVerificationFindFirst
        .mockResolvedValueOnce({ id: 'totp-record-id' })
        .mockResolvedValueOnce(null);

      await svc.refreshSession('raw-opaque-session-token');

      expect(mockJwtService.sign).toHaveBeenCalledWith(
        expect.objectContaining({
          sub: 'user-uuid-123',
          email: 'test@example.com',
          sid: 'session-id-abc',
          mfa_pending: true,
        }),
      );
    });

    it('should map all RefreshRow fields correctly onto BaSession and BaUser', async () => {
      const { svc } = buildService();

      mockQueryRaw.mockResolvedValue([mockRefreshRow]);

      const result = await svc.refreshSession('raw-opaque-session-token');

      expect(result.session).toMatchObject({
        id: 'session-id-abc',
        userId: 'user-uuid-123',
        token: 'raw-opaque-session-token',
        ipAddress: null,
        userAgent: null,
      });
      expect(result.user).toMatchObject({
        id: 'user-uuid-123',
        email: 'test@example.com',
        name: 'Test User',
        emailVerified: false,
      });
    });

    it('should throw UnauthorizedException when session token is not found', async () => {
      const { svc } = buildService();

      // $queryRaw returns no rows — token does not exist in DB at all
      mockQueryRaw.mockResolvedValue([]);
      mockSessionFindFirst.mockResolvedValue(null);

      await expect(
        svc.refreshSession('non-existent-token'),
      ).rejects.toMatchObject({
        code: ErrorCode.AUTH_SESSION_EXPIRED,
      });
      expect(mockQueryRaw).toHaveBeenCalledTimes(1);
      // Secondary lookup to distinguish not-found vs expired
      expect(mockSessionFindFirst).toHaveBeenCalledWith({
        where: { token: 'non-existent-token' },
        select: { id: true },
      });
    });

    it('should throw UnauthorizedException and fire-and-forget delete when session is expired', async () => {
      const { svc } = buildService();

      // $queryRaw returns no rows — token exists but is expired (WHERE expires_at > NOW() failed)
      mockQueryRaw.mockResolvedValue([]);
      mockSessionFindFirst.mockResolvedValue({ id: 'session-id-abc' }); // token exists
      mockSessionDeleteMany.mockResolvedValue({ count: 1 });

      await expect(
        svc.refreshSession('expired-session-token'),
      ).rejects.toMatchObject({
        code: ErrorCode.AUTH_SESSION_EXPIRED,
      });
      expect(mockQueryRaw).toHaveBeenCalledTimes(1);
      expect(mockSessionFindFirst).toHaveBeenCalledWith({
        where: { token: 'expired-session-token' },
        select: { id: true },
      });
      // deleteMany is fire-and-forget — it must have been called (the promise is not awaited
      // but Jest's mock records the call synchronously at invocation time)
      expect(mockSessionDeleteMany).toHaveBeenCalledWith({
        where: { token: 'expired-session-token' },
      });
    });
  });

  // ---------------------------------------------------------------------------
  // resetPasswordForEmail
  // ---------------------------------------------------------------------------

  describe('resetPasswordForEmail', () => {
    beforeEach(() => {
      process.env.EMAIL_ENABLED = 'true';
    });

    afterEach(() => {
      delete process.env.EMAIL_ENABLED;
    });

    it('should create a verification token when email exists', async () => {
      const { svc } = buildService();

      mockUsersFindUnique.mockResolvedValue(mockDbUser);
      mockVerificationDeleteMany.mockResolvedValue({ count: 0 });
      mockVerificationCreate.mockResolvedValue({});

      await expect(
        svc.resetPasswordForEmail('test@example.com'),
      ).resolves.toBeUndefined();

      expect(mockVerificationDeleteMany).toHaveBeenCalledWith({
        where: { identifier: 'password-reset:test@example.com' },
      });
      expect(mockVerificationCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            identifier: 'password-reset:test@example.com',
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

    it('should throw ServiceUnavailableException when EMAIL_ENABLED is not set', async () => {
      delete process.env.EMAIL_ENABLED;
      const { svc } = buildService();

      await expect(
        svc.resetPasswordForEmail('test@example.com'),
      ).rejects.toThrow(ServiceUnavailableException);

      expect(mockVerificationCreate).not.toHaveBeenCalled();
    });
  });

  // ---------------------------------------------------------------------------
  // resetPasswordWithToken
  // ---------------------------------------------------------------------------

  describe('resetPasswordWithToken', () => {
    const resetToken = 'reset-token-abc';
    const resetIdentifier = 'password-reset:test@example.com';
    const futureDate = new Date(Date.now() + 60 * 60 * 1000);

    beforeEach(() => {
      mockTransaction.mockImplementation(async (ops: Promise<unknown>[]) =>
        Promise.all(ops),
      );
    });

    it('should update the credential hash and consume all reset tokens', async () => {
      const { svc } = buildService();

      mockVerificationFindFirst.mockResolvedValue({
        id: 'verification-reset-1',
        identifier: resetIdentifier,
        value: resetToken,
        expiresAt: futureDate,
      });
      mockUsersFindUnique.mockResolvedValue(mockDbUser);
      mockAccountFindFirst.mockResolvedValue(mockDbAccount);
      mockAccountUpdate.mockResolvedValue({});
      mockVerificationDeleteMany.mockResolvedValue({ count: 1 });

      await expect(
        svc.resetPasswordWithToken(resetToken, 'NewPassword123!'),
      ).resolves.toEqual({ userId: 'user-uuid-123' });

      expect(mockVerificationFindFirst).toHaveBeenCalledWith({
        where: {
          value: resetToken,
          identifier: { startsWith: 'password-reset:' },
        },
      });
      expect(mockAccountUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: mockDbAccount.id },
          data: expect.objectContaining({
            password: expect.stringMatching(/^\$2[ab]\$12\$/),
          }),
        }),
      );
      expect(mockVerificationDeleteMany).toHaveBeenCalledWith({
        where: { identifier: resetIdentifier },
      });
    });

    it('should reject an unknown token', async () => {
      const { svc } = buildService();

      mockVerificationFindFirst.mockResolvedValue(null);

      await expect(
        svc.resetPasswordWithToken('missing-token', 'NewPassword123!'),
      ).rejects.toMatchObject({
        code: ErrorCode.AUTH_PASSWORD_RESET_TOKEN_INVALID,
      });
      expect(mockAccountUpdate).not.toHaveBeenCalled();
    });

    it('should delete and reject an expired token', async () => {
      const { svc } = buildService();

      mockVerificationFindFirst.mockResolvedValue({
        id: 'verification-reset-expired',
        identifier: resetIdentifier,
        value: resetToken,
        expiresAt: new Date(Date.now() - 1000),
      });
      mockVerificationDelete.mockResolvedValue({});

      await expect(
        svc.resetPasswordWithToken(resetToken, 'NewPassword123!'),
      ).rejects.toMatchObject({
        code: ErrorCode.AUTH_PASSWORD_RESET_TOKEN_EXPIRED,
      });
      expect(mockVerificationDelete).toHaveBeenCalledWith({
        where: { id: 'verification-reset-expired' },
      });
      expect(mockAccountUpdate).not.toHaveBeenCalled();
    });

    it('should fail closed for OAuth-only users without creating a credential', async () => {
      const { svc } = buildService();

      mockVerificationFindFirst.mockResolvedValue({
        id: 'verification-reset-1',
        identifier: resetIdentifier,
        value: resetToken,
        expiresAt: futureDate,
      });
      mockUsersFindUnique.mockResolvedValue(mockDbUser);
      mockAccountFindFirst.mockResolvedValue(null);
      mockVerificationDeleteMany.mockResolvedValue({ count: 1 });

      await expect(
        svc.resetPasswordWithToken(resetToken, 'NewPassword123!'),
      ).rejects.toMatchObject({
        code: ErrorCode.AUTH_PASSWORD_RESET_TOKEN_INVALID,
      });
      expect(mockAccountCreate).not.toHaveBeenCalled();
      expect(mockAccountUpdate).not.toHaveBeenCalled();
      expect(mockVerificationDeleteMany).toHaveBeenCalledWith({
        where: { identifier: resetIdentifier },
      });
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
      ).rejects.toMatchObject({ code: ErrorCode.USER_NOT_FOUND });
    });
  });

  describe('updateOwnPassword', () => {
    it('should reject when current password is wrong', async () => {
      const { svc } = buildService();
      const bcrypt = require('bcryptjs');
      const realHash = await bcrypt.hash('CorrectPassword123!', 12);

      mockAccountFindFirst.mockResolvedValue({
        ...mockDbAccount,
        password: realHash,
      });

      await expect(
        svc.updateOwnPassword(
          'user-uuid-123',
          'WrongPassword123!',
          'NewPassword123!',
        ),
      ).rejects.toMatchObject({ code: ErrorCode.AUTH_INVALID_CREDENTIALS });
      expect(mockAccountUpdate).not.toHaveBeenCalled();
    });

    it('should update hash when current password is correct', async () => {
      const { svc } = buildService();
      const bcrypt = require('bcryptjs');
      const realHash = await bcrypt.hash('CurrentPassword123!', 12);

      mockAccountFindFirst.mockResolvedValue({
        ...mockDbAccount,
        password: realHash,
      });
      mockAccountUpdate.mockResolvedValue({});

      await expect(
        svc.updateOwnPassword(
          'user-uuid-123',
          'CurrentPassword123!',
          'NewPassword123!',
        ),
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
  });
});
