import { Test, TestingModule } from '@nestjs/testing';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { FcmTokensService } from './fcm-tokens.service';

describe('FcmTokensService', () => {
  let service: FcmTokensService;

  const mockPrismaService = {
    user_fcm_tokens: {
      findFirst: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
      create: jest.fn(),
      findMany: jest.fn(),
      deleteMany: jest.fn(),
    },
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        FcmTokensService,
        { provide: PrismaService, useValue: mockPrismaService },
      ],
    }).compile();

    service = module.get<FcmTokensService>(FcmTokensService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('registerToken', () => {
    it('should update existing token and reassign user', async () => {
      mockPrismaService.user_fcm_tokens.findFirst.mockResolvedValue({
        fcm_token_id: 'token-id',
        user_id: 'old-user',
      });
      mockPrismaService.user_fcm_tokens.update.mockResolvedValue({
        fcm_token_id: 'token-id',
        user_id: 'new-user',
      });

      const result = await service.registerToken('new-user', {
        token: 'fcm-token',
      });

      expect(mockPrismaService.user_fcm_tokens.update).toHaveBeenCalledWith({
        where: { fcm_token_id: 'token-id' },
        data: expect.objectContaining({
          user_id: 'new-user',
          active: true,
        }),
        select: expect.any(Object),
      });
      expect(result.user_id).toBe('new-user');
    });

    it('should create token when it does not exist', async () => {
      mockPrismaService.user_fcm_tokens.findFirst.mockResolvedValue(null);
      mockPrismaService.user_fcm_tokens.create.mockResolvedValue({
        fcm_token_id: 'new-token-id',
        user_id: 'user-1',
      });

      const result = await service.registerToken('user-1', {
        token: 'fcm-token',
      });

      expect(mockPrismaService.user_fcm_tokens.create).toHaveBeenCalled();
      expect(result.user_id).toBe('user-1');
    });
  });

  describe('unregisterToken', () => {
    it('should throw NotFoundException when token does not exist', async () => {
      mockPrismaService.user_fcm_tokens.findFirst.mockResolvedValue(null);

      await expect(
        service.unregisterToken('missing-token', 'user-1'),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw ForbiddenException when token belongs to another user', async () => {
      mockPrismaService.user_fcm_tokens.findFirst.mockResolvedValue({
        token: 'fcm-token',
        user_id: 'other-user',
      });

      await expect(
        service.unregisterToken('fcm-token', 'user-1'),
      ).rejects.toThrow(ForbiddenException);
    });

    it('should unregister token when user owns it', async () => {
      mockPrismaService.user_fcm_tokens.findFirst.mockResolvedValue({
        token: 'fcm-token',
        user_id: 'user-1',
      });
      mockPrismaService.user_fcm_tokens.updateMany.mockResolvedValue({
        count: 1,
      });

      const result = await service.unregisterToken('fcm-token', 'user-1');

      expect(result).toEqual({
        success: true,
        message: 'FCM token unregistered successfully',
      });
    });
  });
});
