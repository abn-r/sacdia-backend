import { Test, TestingModule } from '@nestjs/testing';
import { OAuthService } from './oauth.service';
import { PrismaService } from '../prisma/prisma.service';
import { ErrorCode } from '../common/errors/error-codes';

/**
 * OAuthService unit tests — connected providers only.
 * Connected providers are read from the `accounts` table (not boolean flags).
 * Sign-in is covered by the social-sign-in specs.
 */
describe('OAuthService', () => {
  let service: OAuthService;

  // ---------------------------------------------------------------------------
  // Service mocks
  // ---------------------------------------------------------------------------
  const mockPrismaService = {
    account: {
      findMany: jest.fn(),
      deleteMany: jest.fn(),
    },
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OAuthService,
        { provide: PrismaService, useValue: mockPrismaService },
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
      ).rejects.toMatchObject({ code: ErrorCode.AUTH_OAUTH_PROVIDER_INVALID });
    });

    it('should throw BadRequestException when user would lose last auth method', async () => {
      // Only Google, no credential account
      mockPrismaService.account.findMany.mockResolvedValue([
        { providerId: 'google' },
      ]);

      await expect(
        service.disconnectProvider('user-123', 'google'),
      ).rejects.toMatchObject({ code: ErrorCode.AUTH_OAUTH_ONLY_AUTH_METHOD });
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
      ).rejects.toMatchObject({
        code: ErrorCode.AUTH_OAUTH_PROVIDER_NOT_CONNECTED,
      });
    });
  });
});
