import { Test, TestingModule } from '@nestjs/testing';
import {
  BadRequestException,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { AccountDeletionService } from './account-deletion.service';
import { PrismaService } from '../prisma/prisma.service';
import {
  FILE_STORAGE_SERVICE,
  StorageBucketAlias,
} from '../common/services/file-storage.service';

jest.mock('bcryptjs');
const bcryptMock = bcrypt as jest.Mocked<typeof bcrypt>;

const USER_ID = '00000000-0000-0000-0000-000000000001';
const PASSWORD = 'ValidPassword123!';
const HASHED = '$2a$12$hashed';

const mockPrisma = {
  users: {
    findUnique: jest.fn(),
    update: jest.fn(),
  },
  account: {
    findFirst: jest.fn(),
    deleteMany: jest.fn(),
  },
  session: {
    deleteMany: jest.fn(),
  },
  user_fcm_tokens: {
    updateMany: jest.fn(),
  },
  account_deletion_log: {
    create: jest.fn(),
  },
  $transaction: jest.fn(),
};

const mockFileStorage = {
  extractKeyFromPublicUrl: jest.fn(),
  deleteMany: jest.fn(),
};

describe('AccountDeletionService', () => {
  let service: AccountDeletionService;

  beforeEach(async () => {
    jest.clearAllMocks();

    // Default: transaction calls the callback with mockPrisma as tx
    mockPrisma.$transaction.mockImplementation(async (fn: (tx: any) => Promise<any>) =>
      fn(mockPrisma),
    );

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AccountDeletionService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: FILE_STORAGE_SERVICE, useValue: mockFileStorage },
      ],
    }).compile();

    service = module.get<AccountDeletionService>(AccountDeletionService);
  });

  // -------------------------------------------------------------------------
  // Happy path
  // -------------------------------------------------------------------------

  describe('deleteAccount — happy path', () => {
    beforeEach(() => {
      mockPrisma.users.findUnique.mockResolvedValue({
        user_id: USER_ID,
        email: 'user@sacdia.app',
        active: true,
        user_image: 'profiles/avatar.jpg',
      });

      mockPrisma.account.findFirst.mockResolvedValue({
        password: HASHED,
      });

      (bcryptMock.compare as jest.Mock).mockResolvedValue(true);

      mockPrisma.session.deleteMany.mockResolvedValue({ count: 2 });
      mockPrisma.user_fcm_tokens.updateMany.mockResolvedValue({ count: 1 });
      mockPrisma.users.update.mockResolvedValue({});
      mockPrisma.account.deleteMany.mockResolvedValue({ count: 1 });
      mockPrisma.account_deletion_log.create.mockResolvedValue({});
    });

    it('should complete without throwing', async () => {
      await expect(
        service.deleteAccount(USER_ID, PASSWORD, '127.0.0.1'),
      ).resolves.toBeUndefined();
    });

    it('should revoke all BA sessions inside transaction', async () => {
      await service.deleteAccount(USER_ID, PASSWORD);
      expect(mockPrisma.session.deleteMany).toHaveBeenCalledWith({
        where: { userId: USER_ID },
      });
    });

    it('should deactivate FCM tokens inside transaction', async () => {
      await service.deleteAccount(USER_ID, PASSWORD);
      expect(mockPrisma.user_fcm_tokens.updateMany).toHaveBeenCalledWith({
        where: { user_id: USER_ID },
        data: { active: false },
      });
    });

    it('should soft-delete and anonymize PII on users row', async () => {
      await service.deleteAccount(USER_ID, PASSWORD);
      const updateCall = mockPrisma.users.update.mock.calls[0][0];
      expect(updateCall.where.user_id).toBe(USER_ID);
      expect(updateCall.data.active).toBe(false);
      expect(updateCall.data.email).toBe(`deleted-${USER_ID}@sacdia.deleted`);
      expect(updateCall.data.name).toBeNull();
      expect(updateCall.data.birthday).toBeNull();
    });

    it('should delete credential account row', async () => {
      await service.deleteAccount(USER_ID, PASSWORD);
      expect(mockPrisma.account.deleteMany).toHaveBeenCalledWith({
        where: { userId: USER_ID },
      });
    });

    it('should write an account_deletion_log entry', async () => {
      await service.deleteAccount(USER_ID, PASSWORD);
      expect(mockPrisma.account_deletion_log.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ user_id: USER_ID }),
        }),
      );
    });

    it('should attempt R2 deletion for existing user_image (fire-and-forget)', async () => {
      mockFileStorage.extractKeyFromPublicUrl.mockReturnValue('profiles/avatar.jpg');
      mockFileStorage.deleteMany.mockResolvedValue(undefined);

      await service.deleteAccount(USER_ID, PASSWORD);

      // Give the fire-and-forget microtask a tick to settle
      await Promise.resolve();

      expect(mockFileStorage.deleteMany).toHaveBeenCalledWith(
        StorageBucketAlias.USER_PROFILES,
        ['profiles/avatar.jpg'],
      );
    });

    it('should NOT throw when R2 deletion fails (fire-and-forget)', async () => {
      mockFileStorage.extractKeyFromPublicUrl.mockReturnValue('profiles/avatar.jpg');
      mockFileStorage.deleteMany.mockRejectedValue(new Error('R2 down'));

      await expect(
        service.deleteAccount(USER_ID, PASSWORD),
      ).resolves.toBeUndefined();
    });
  });

  // -------------------------------------------------------------------------
  // Auth failures
  // -------------------------------------------------------------------------

  describe('deleteAccount — auth failures', () => {
    it('should throw NotFoundException when user does not exist', async () => {
      mockPrisma.users.findUnique.mockResolvedValue(null);

      await expect(
        service.deleteAccount(USER_ID, PASSWORD),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw BadRequestException when account is already deleted', async () => {
      mockPrisma.users.findUnique.mockResolvedValue({
        user_id: USER_ID,
        email: `deleted-${USER_ID}@sacdia.deleted`,
        active: false,
        user_image: null,
      });

      await expect(
        service.deleteAccount(USER_ID, PASSWORD),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw UnauthorizedException when password is wrong', async () => {
      mockPrisma.users.findUnique.mockResolvedValue({
        user_id: USER_ID,
        email: 'user@sacdia.app',
        active: true,
        user_image: null,
      });
      mockPrisma.account.findFirst.mockResolvedValue({ password: HASHED });
      (bcryptMock.compare as jest.Mock).mockResolvedValue(false);

      await expect(
        service.deleteAccount(USER_ID, PASSWORD),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('should skip password check for OAuth-only users (no credential account)', async () => {
      mockPrisma.users.findUnique.mockResolvedValue({
        user_id: USER_ID,
        email: 'user@sacdia.app',
        active: true,
        user_image: null,
      });
      mockPrisma.account.findFirst.mockResolvedValue(null);
      mockPrisma.session.deleteMany.mockResolvedValue({ count: 0 });
      mockPrisma.user_fcm_tokens.updateMany.mockResolvedValue({ count: 0 });
      mockPrisma.users.update.mockResolvedValue({});
      mockPrisma.account.deleteMany.mockResolvedValue({ count: 0 });
      mockPrisma.account_deletion_log.create.mockResolvedValue({});

      // Should NOT throw — OAuth user, no password to verify
      await expect(
        service.deleteAccount(USER_ID, PASSWORD),
      ).resolves.toBeUndefined();
    });
  });

  // -------------------------------------------------------------------------
  // Rate limit awareness (controller-level — service just executes)
  // -------------------------------------------------------------------------

  it('should execute the transaction atomically', async () => {
    mockPrisma.users.findUnique.mockResolvedValue({
      user_id: USER_ID,
      email: 'user@sacdia.app',
      active: true,
      user_image: null,
    });
    mockPrisma.account.findFirst.mockResolvedValue({ password: HASHED });
    (bcryptMock.compare as jest.Mock).mockResolvedValue(true);
    mockPrisma.session.deleteMany.mockResolvedValue({ count: 0 });
    mockPrisma.user_fcm_tokens.updateMany.mockResolvedValue({ count: 0 });
    mockPrisma.users.update.mockResolvedValue({});
    mockPrisma.account.deleteMany.mockResolvedValue({ count: 0 });
    mockPrisma.account_deletion_log.create.mockResolvedValue({});

    await service.deleteAccount(USER_ID, PASSWORD);

    // Confirm $transaction was called once
    expect(mockPrisma.$transaction).toHaveBeenCalledTimes(1);
  });
});
