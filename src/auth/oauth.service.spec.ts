import { Test, TestingModule } from '@nestjs/testing';
import { OAuthService } from './oauth.service';
import { PrismaService } from '../prisma/prisma.service';
import { SupabaseService } from '../common/supabase.service';
import { FILE_STORAGE_SERVICE } from '../common/services/file-storage.service';
import {
  BadRequestException,
  InternalServerErrorException,
  UnauthorizedException,
} from '@nestjs/common';

describe('OAuthService', () => {
  let service: OAuthService;

  const mockTx = {
    users: {
      create: jest.fn(),
    },
    users_pr: {
      create: jest.fn(),
    },
    roles: {
      findFirst: jest.fn(),
    },
    users_roles: {
      create: jest.fn(),
    },
  };

  const mockPrismaService = {
    $transaction: jest.fn(),
    users: {
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    users_pr: {
      findUnique: jest.fn(),
    },
  };

  const mockSupabaseService = {
    admin: {
      auth: {
        signInWithOAuth: jest.fn(),
        getUser: jest.fn(),
      },
    },
  };

  const mockFileStorageService = {
    getSignedDownloadUrl: jest.fn(async (_bucket: unknown, value: string) => value),
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
        { provide: SupabaseService, useValue: mockSupabaseService },
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

  describe('initiateGoogleSignIn', () => {
    it('should return OAuth URL for Google with custom redirect', async () => {
      mockSupabaseService.admin.auth.signInWithOAuth.mockResolvedValue({
        data: { url: 'https://accounts.google.com/o/oauth2/auth' },
        error: null,
      });

      const result = await service.initiateGoogleSignIn(
        'https://sacdia.app/auth/callback',
      );

      expect(mockSupabaseService.admin.auth.signInWithOAuth).toHaveBeenCalledWith(
        {
          provider: 'google',
          options: {
            redirectTo: 'https://sacdia.app/auth/callback',
          },
        },
      );
      expect(result).toEqual({
        url: 'https://accounts.google.com/o/oauth2/auth',
      });
    });

    it('should throw InternalServerErrorException when Google OAuth fails', async () => {
      mockSupabaseService.admin.auth.signInWithOAuth.mockResolvedValue({
        data: null,
        error: { message: 'Google provider not available' },
      });

      await expect(service.initiateGoogleSignIn()).rejects.toThrow(
        InternalServerErrorException,
      );
    });
  });

  describe('initiateAppleSignIn', () => {
    it('should use default redirect URL when redirect is not provided', async () => {
      mockSupabaseService.admin.auth.signInWithOAuth.mockResolvedValue({
        data: { url: 'https://appleid.apple.com/auth/authorize' },
        error: null,
      });

      const result = await service.initiateAppleSignIn();

      expect(mockSupabaseService.admin.auth.signInWithOAuth).toHaveBeenCalledWith(
        {
          provider: 'apple',
          options: {
            redirectTo: 'https://sacdia.app/auth/callback',
          },
        },
      );
      expect(result).toEqual({
        url: 'https://appleid.apple.com/auth/authorize',
      });
    });

    it('should throw InternalServerErrorException when Apple OAuth fails', async () => {
      mockSupabaseService.admin.auth.signInWithOAuth.mockResolvedValue({
        data: null,
        error: { message: 'Apple provider not available' },
      });

      await expect(service.initiateAppleSignIn()).rejects.toThrow(
        InternalServerErrorException,
      );
    });
  });

  describe('handleCallback', () => {
    it('should throw UnauthorizedException when callback token is invalid', async () => {
      mockSupabaseService.admin.auth.getUser.mockResolvedValue({
        data: { user: null },
        error: { message: 'invalid token' },
      });

      await expect(
        service.handleCallback({
          access_token: 'bad-token',
        }),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('should return user payload for existing user and update provider flags', async () => {
      mockSupabaseService.admin.auth.getUser.mockResolvedValue({
        data: {
          user: {
            id: 'user-123',
            email: 'juan.garcia@example.com',
            identities: [{ provider: 'google' }],
          },
        },
        error: null,
      });
      mockPrismaService.users.findUnique.mockResolvedValue({
        user_id: 'user-123',
        email: 'juan.garcia@example.com',
        name: 'Juan',
        paternal_last_name: 'Garcia',
        maternal_last_name: 'Lopez',
        user_image: 'https://avatar.test/user-123.png',
      });
      mockPrismaService.users.update.mockResolvedValue({
        user_id: 'user-123',
      });
      mockPrismaService.users_pr.findUnique.mockResolvedValue({
        user_id: 'user-123',
        complete: false,
      });

      const result = await service.handleCallback({
        access_token: 'access-token',
        refresh_token: 'refresh-token',
      });

      expect(mockPrismaService.users.update).toHaveBeenCalledWith({
        where: { user_id: 'user-123' },
        data: {
          google_connected: true,
          apple_connected: false,
        },
      });
      expect(result).toEqual({
        accessToken: 'access-token',
        refreshToken: 'refresh-token',
        user: {
          id: 'user-123',
          email: 'juan.garcia@example.com',
          name: 'Juan',
          paternal_last_name: 'Garcia',
          maternal_last_name: 'Lopez',
          avatar: 'https://avatar.test/user-123.png',
          google_connected: true,
          apple_connected: false,
        },
        needsPostRegistration: true,
      });
    });

    it('should create local user on first OAuth login', async () => {
      mockSupabaseService.admin.auth.getUser.mockResolvedValue({
        data: {
          user: {
            id: 'new-user-123',
            email: 'new.user@example.com',
            user_metadata: {
              name: 'New User',
              avatar_url: 'https://avatar.test/new-user.png',
            },
            identities: [{ provider: 'google' }, { provider: 'apple' }],
          },
        },
        error: null,
      });
      mockPrismaService.users.findUnique.mockResolvedValue(null);
      mockTx.users.create.mockResolvedValue({
        user_id: 'new-user-123',
        email: 'new.user@example.com',
        name: 'New User',
        paternal_last_name: null,
        maternal_last_name: null,
        user_image: 'https://avatar.test/new-user.png',
      });
      mockTx.users_pr.create.mockResolvedValue({
        user_id: 'new-user-123',
        complete: false,
      });
      mockTx.roles.findFirst.mockResolvedValue({
        role_id: 1,
      });
      mockTx.users_roles.create.mockResolvedValue({
        user_id: 'new-user-123',
        role_id: 1,
      });
      mockPrismaService.users.update.mockResolvedValue({
        user_id: 'new-user-123',
      });
      mockPrismaService.users_pr.findUnique.mockResolvedValue({
        user_id: 'new-user-123',
        complete: true,
      });

      const result = await service.handleCallback({
        access_token: 'access-token',
      });

      expect(mockPrismaService.$transaction).toHaveBeenCalled();
      expect(mockTx.users.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          user_id: 'new-user-123',
          email: 'new.user@example.com',
          name: 'New User',
        }),
      });
      expect(mockTx.users_roles.create).toHaveBeenCalled();
      expect(result.user.google_connected).toBe(true);
      expect(result.user.apple_connected).toBe(true);
      expect(result.needsPostRegistration).toBe(false);
    });
  });

  describe('getConnectedProviders', () => {
    it('should return provider flags for existing user', async () => {
      mockPrismaService.users.findUnique.mockResolvedValue({
        google_connected: true,
        apple_connected: false,
        fb_connected: false,
      });

      const result = await service.getConnectedProviders('user-123');

      expect(result).toEqual({
        google_connected: true,
        apple_connected: false,
        fb_connected: false,
      });
    });

    it('should throw BadRequestException when user does not exist', async () => {
      mockPrismaService.users.findUnique.mockResolvedValue(null);

      await expect(service.getConnectedProviders('missing-user')).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  describe('disconnectProvider', () => {
    it('should throw BadRequestException for invalid provider', async () => {
      await expect(
        service.disconnectProvider('user-123', 'github'),
      ).rejects.toThrow(BadRequestException);
    });

    it('should update provider flag when provider is valid', async () => {
      mockPrismaService.users.update.mockResolvedValue({
        user_id: 'user-123',
      });

      const result = await service.disconnectProvider('user-123', 'google');

      expect(mockPrismaService.users.update).toHaveBeenCalledWith({
        where: { user_id: 'user-123' },
        data: { google_connected: false },
      });
      expect(result).toEqual({
        success: true,
        message: 'Provider desconectado exitosamente',
      });
    });
  });
});
