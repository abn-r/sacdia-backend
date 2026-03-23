import { Test, TestingModule } from '@nestjs/testing';
import { OAuthService } from './oauth.service';
import { PrismaService } from '../prisma/prisma.service';
import { BetterAuthService } from '../better-auth/better-auth.service';
import { FILE_STORAGE_SERVICE } from '../common/services/file-storage.service';
import {
  BadRequestException,
  UnauthorizedException,
} from '@nestjs/common';

/**
 * OAuthService unit tests — Better Auth edition (W3-008 Part 3).
 *
 * OAuthService now uses BetterAuthService (not SupabaseService).
 * Connected providers are read from the `accounts` table (not boolean flags).
 * Old fields `google_connected`, `apple_connected`, `fb_connected` removed.
 */
describe('OAuthService', () => {
  let service: OAuthService;

  // ---------------------------------------------------------------------------
  // Transaction inner context
  // ---------------------------------------------------------------------------
  const mockTx = {
    users: {
      findUnique: jest.fn(),
      create: jest.fn(),
    },
    users_pr: {
      findUnique: jest.fn(),
      create: jest.fn(),
    },
    roles: {
      findFirst: jest.fn(),
    },
    users_roles: {
      findFirst: jest.fn(),
      create: jest.fn(),
    },
  };

  // ---------------------------------------------------------------------------
  // Service mocks
  // ---------------------------------------------------------------------------
  const mockPrismaService = {
    $transaction: jest.fn(),
    users: {
      findUnique: jest.fn(),
    },
    users_pr: {
      findUnique: jest.fn(),
    },
    account: {
      findMany: jest.fn(),
      deleteMany: jest.fn(),
    },
  };

  const mockBetterAuthService = {
    getOAuthUrl: jest.fn(),
    refreshSession: jest.fn(),
  };

  const mockFileStorageService = {
    getSignedDownloadUrl: jest.fn(
      async (_bucket: unknown, value: string) => value,
    ),
  };

  beforeEach(async () => {
    mockPrismaService.$transaction.mockImplementation(
      async (callback: (tx: typeof mockTx) => Promise<unknown>) =>
        callback(mockTx),
    );

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OAuthService,
        { provide: PrismaService, useValue: mockPrismaService },
        { provide: BetterAuthService, useValue: mockBetterAuthService },
        { provide: FILE_STORAGE_SERVICE, useValue: mockFileStorageService },
      ],
    }).compile();

    service = module.get<OAuthService>(OAuthService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  // ---------------------------------------------------------------------------
  // initiateGoogleSignIn
  // ---------------------------------------------------------------------------
  describe('initiateGoogleSignIn', () => {
    it('should return OAuth URL for Google with custom redirect', async () => {
      mockBetterAuthService.getOAuthUrl.mockResolvedValue({
        url: 'https://accounts.google.com/o/oauth2/auth?state=xyz',
        state: 'xyz',
      });

      const result = await service.initiateGoogleSignIn(
        'https://sacdia.app/auth/callback',
      );

      expect(mockBetterAuthService.getOAuthUrl).toHaveBeenCalledWith(
        'google',
        'https://sacdia.app/auth/callback',
      );
      expect(result).toEqual({
        url: 'https://accounts.google.com/o/oauth2/auth?state=xyz',
      });
    });

    it('should use default redirect URL when redirect is not provided', async () => {
      mockBetterAuthService.getOAuthUrl.mockResolvedValue({
        url: 'https://accounts.google.com/o/oauth2/auth',
        state: 'abc',
      });

      const result = await service.initiateGoogleSignIn();

      expect(mockBetterAuthService.getOAuthUrl).toHaveBeenCalledWith(
        'google',
        'https://sacdia.app/auth/callback',
      );
      expect(result).toHaveProperty('url');
    });
  });

  // ---------------------------------------------------------------------------
  // initiateAppleSignIn
  // ---------------------------------------------------------------------------
  describe('initiateAppleSignIn', () => {
    it('should use default redirect URL when redirect is not provided', async () => {
      mockBetterAuthService.getOAuthUrl.mockResolvedValue({
        url: 'https://appleid.apple.com/auth/authorize',
        state: 'abc',
      });

      const result = await service.initiateAppleSignIn();

      expect(mockBetterAuthService.getOAuthUrl).toHaveBeenCalledWith(
        'apple',
        'https://sacdia.app/auth/callback',
      );
      expect(result).toEqual({
        url: 'https://appleid.apple.com/auth/authorize',
      });
    });

    it('should return OAuth URL for Apple with custom redirect', async () => {
      mockBetterAuthService.getOAuthUrl.mockResolvedValue({
        url: 'https://appleid.apple.com/auth/authorize?state=xyz',
        state: 'xyz',
      });

      const result = await service.initiateAppleSignIn(
        'https://sacdia.app/auth/callback',
      );

      expect(mockBetterAuthService.getOAuthUrl).toHaveBeenCalledWith(
        'apple',
        'https://sacdia.app/auth/callback',
      );
      expect(result).toHaveProperty('url');
    });
  });

  // ---------------------------------------------------------------------------
  // handleCallback
  // ---------------------------------------------------------------------------
  describe('handleCallback', () => {
    const baResult = {
      user: { id: 'user-123', email: 'juan@example.com', name: 'Juan', image: null },
      session: { token: 'ba-session-token', expiresAt: new Date() },
      accessToken: 'sacdia-hs256-jwt',
    };

    it('should throw UnauthorizedException when session token is invalid', async () => {
      mockBetterAuthService.refreshSession.mockRejectedValue(
        new UnauthorizedException('Session not found or expired'),
      );

      await expect(
        service.handleCallback({ session_token: 'bad-token' }),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('should return user payload for existing SACDIA user', async () => {
      mockBetterAuthService.refreshSession.mockResolvedValue(baResult);

      // ensureSacdiaUserProvisioned — user exists, pr exists, role exists
      mockTx.users.findUnique.mockResolvedValue({ user_id: 'user-123' });
      mockTx.users_pr.findUnique.mockResolvedValue({ user_id: 'user-123', complete: false });
      mockTx.users_roles.findFirst.mockResolvedValue({ user_id: 'user-123', role_id: 1 });

      // outer prisma calls
      mockPrismaService.users.findUnique.mockResolvedValue({
        user_id: 'user-123',
        name: 'Juan',
        paternal_last_name: 'Garcia',
        maternal_last_name: 'Lopez',
        user_image: 'https://avatar.test/user-123.png',
      });
      mockPrismaService.users_pr.findUnique.mockResolvedValue({
        user_id: 'user-123',
        complete: false,
      });
      mockPrismaService.account.findMany.mockResolvedValue([
        { providerId: 'google' },
      ]);

      const result = await service.handleCallback({ session_token: 'ba-session-token' });

      expect(mockBetterAuthService.refreshSession).toHaveBeenCalledWith('ba-session-token');
      expect(result).toEqual({
        accessToken: 'sacdia-hs256-jwt',
        sessionToken: 'ba-session-token',
        user: {
          id: 'user-123',
          email: 'juan@example.com',
          name: 'Juan',
          paternal_last_name: 'Garcia',
          maternal_last_name: 'Lopez',
          avatar: 'https://avatar.test/user-123.png',
          connectedProviders: ['google'],
        },
        needsPostRegistration: true,
      });
    });

    it('should provision SACDIA rows for new OAuth user', async () => {
      mockBetterAuthService.refreshSession.mockResolvedValue(baResult);

      // ensureSacdiaUserProvisioned — user exists in BA but no SACDIA rows
      mockTx.users.findUnique.mockResolvedValue({ user_id: 'user-123' });
      mockTx.users_pr.findUnique.mockResolvedValue(null); // no pr row
      mockTx.users_pr.create.mockResolvedValue({ user_id: 'user-123' });
      mockTx.users_roles.findFirst.mockResolvedValue(null); // no role
      mockTx.roles.findFirst.mockResolvedValue({ role_id: 1 });
      mockTx.users_roles.create.mockResolvedValue({ user_id: 'user-123', role_id: 1 });

      mockPrismaService.users.findUnique.mockResolvedValue({
        user_id: 'user-123',
        name: 'Juan',
        paternal_last_name: null,
        maternal_last_name: null,
        user_image: null,
      });
      mockPrismaService.users_pr.findUnique.mockResolvedValue({
        user_id: 'user-123',
        complete: false,
      });
      mockPrismaService.account.findMany.mockResolvedValue([
        { providerId: 'google' },
        { providerId: 'credential' },
      ]);

      const result = await service.handleCallback({ session_token: 'ba-session-token' });

      expect(mockTx.users_pr.create).toHaveBeenCalled();
      expect(mockTx.users_roles.create).toHaveBeenCalled();
      // credential is filtered out from connectedProviders
      expect(result.user.connectedProviders).toEqual(['google']);
      expect(result.needsPostRegistration).toBe(true);
    });
  });

  // ---------------------------------------------------------------------------
  // getConnectedProviders
  // ---------------------------------------------------------------------------
  describe('getConnectedProviders', () => {
    it('should return OAuth provider list (excluding credential)', async () => {
      mockPrismaService.account.findMany.mockResolvedValue([
        { providerId: 'google' },
        { providerId: 'credential' },
      ]);

      const result = await service.getConnectedProviders('user-123');

      expect(result).toEqual(['google']);
    });

    it('should return empty array when no OAuth providers connected', async () => {
      mockPrismaService.account.findMany.mockResolvedValue([
        { providerId: 'credential' },
      ]);

      const result = await service.getConnectedProviders('user-123');

      expect(result).toEqual([]);
    });

    it('should return multiple providers when connected', async () => {
      mockPrismaService.account.findMany.mockResolvedValue([
        { providerId: 'google' },
        { providerId: 'apple' },
        { providerId: 'credential' },
      ]);

      const result = await service.getConnectedProviders('user-123');

      expect(result).toEqual(['google', 'apple']);
    });
  });

  // ---------------------------------------------------------------------------
  // disconnectProvider
  // ---------------------------------------------------------------------------
  describe('disconnectProvider', () => {
    it('should throw BadRequestException for invalid provider', async () => {
      await expect(
        service.disconnectProvider('user-123', 'github'),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException when user would lose last auth method', async () => {
      // Only Google, no credential account
      mockPrismaService.account.findMany.mockResolvedValue([
        { providerId: 'google' },
      ]);

      await expect(
        service.disconnectProvider('user-123', 'google'),
      ).rejects.toThrow(BadRequestException);
    });

    it('should delete the account row when user has credential fallback', async () => {
      mockPrismaService.account.findMany.mockResolvedValue([
        { providerId: 'google' },
        { providerId: 'credential' },
      ]);
      mockPrismaService.account.deleteMany.mockResolvedValue({ count: 1 });

      const result = await service.disconnectProvider('user-123', 'google');

      expect(mockPrismaService.account.deleteMany).toHaveBeenCalledWith({
        where: { userId: 'user-123', providerId: 'google' },
      });
      expect(result).toEqual({
        success: true,
        message: 'Provider desconectado exitosamente',
      });
    });

    it('should throw BadRequestException when provider was not connected', async () => {
      mockPrismaService.account.findMany.mockResolvedValue([
        { providerId: 'credential' },
        { providerId: 'apple' },
      ]);
      mockPrismaService.account.deleteMany.mockResolvedValue({ count: 0 });

      await expect(
        service.disconnectProvider('user-123', 'google'),
      ).rejects.toThrow(BadRequestException);
    });
  });
});
