import { Test, TestingModule } from '@nestjs/testing';
import * as bcrypt from 'bcryptjs';
import { AccountDeletionService } from './account-deletion.service';
import { PrismaService } from '../prisma/prisma.service';
import {
  FILE_STORAGE_SERVICE,
  StorageBucketAlias,
} from '../common/services/file-storage.service';
import { EmailService } from '../common/email/email.service';
import { ErrorCode } from '../common/errors/error-codes';
import { TokenBlacklistService } from '../common/services/token-blacklist.service';
import { totpIdentifier } from '../better-auth/better-auth.service';
import { AppleTokenClient } from './social-sign-in/apple-token.client';
import {
  APPLE_ID_TOKEN_VERIFIER,
  GOOGLE_ID_TOKEN_VERIFIER,
} from './social-sign-in/social-sign-in.types';

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
    findMany: jest.fn(),
    deleteMany: jest.fn(),
  },
  session: {
    deleteMany: jest.fn(),
  },
  verification: {
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

const credentialAccount = {
  providerId: 'credential',
  accountId: USER_ID,
  password: HASHED,
  refreshToken: null,
};

const mockGoogleVerifier = { provider: 'google', verify: jest.fn() };
const mockAppleVerifier = { provider: 'apple', verify: jest.fn() };
const mockAppleTokens = { revoke: jest.fn() };
const mockTokenBlacklist = {
  blacklistAllUserTokens: jest.fn().mockResolvedValue(undefined),
};

const mockFileStorage = {
  extractKeyFromPublicUrl: jest.fn(),
  deleteMany: jest.fn(),
};

const mockEmailService = {
  sendAccountDeletionConfirmed: jest.fn().mockResolvedValue(undefined),
};

describe('AccountDeletionService', () => {
  let service: AccountDeletionService;

  beforeEach(async () => {
    jest.clearAllMocks();

    // Default: transaction calls the callback with mockPrisma as tx
    mockPrisma.$transaction.mockImplementation(
      async (fn: (tx: any) => Promise<any>) => fn(mockPrisma),
    );

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AccountDeletionService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: FILE_STORAGE_SERVICE, useValue: mockFileStorage },
        { provide: EmailService, useValue: mockEmailService },
        { provide: GOOGLE_ID_TOKEN_VERIFIER, useValue: mockGoogleVerifier },
        { provide: APPLE_ID_TOKEN_VERIFIER, useValue: mockAppleVerifier },
        { provide: AppleTokenClient, useValue: mockAppleTokens },
        { provide: TokenBlacklistService, useValue: mockTokenBlacklist },
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

      mockPrisma.account.findMany.mockResolvedValue([credentialAccount]);

      (bcryptMock.compare as jest.Mock).mockResolvedValue(true);

      mockPrisma.session.deleteMany.mockResolvedValue({ count: 2 });
      mockPrisma.user_fcm_tokens.updateMany.mockResolvedValue({ count: 1 });
      mockPrisma.users.update.mockResolvedValue({});
      mockPrisma.account.deleteMany.mockResolvedValue({ count: 1 });
      mockPrisma.account_deletion_log.create.mockResolvedValue({});
    });

    it('should complete without throwing', async () => {
      await expect(
        service.deleteAccount(USER_ID, { password: PASSWORD }, '127.0.0.1'),
      ).resolves.toBeUndefined();
    });

    it('should revoke all BA sessions inside transaction', async () => {
      await service.deleteAccount(USER_ID, { password: PASSWORD });
      expect(mockPrisma.session.deleteMany).toHaveBeenCalledWith({
        where: { userId: USER_ID },
      });
    });

    it('should deactivate FCM tokens inside transaction', async () => {
      await service.deleteAccount(USER_ID, { password: PASSWORD });
      expect(mockPrisma.user_fcm_tokens.updateMany).toHaveBeenCalledWith({
        where: { user_id: USER_ID },
        data: { active: false },
      });
    });

    it('should soft-delete and anonymize PII on users row', async () => {
      await service.deleteAccount(USER_ID, { password: PASSWORD });
      const updateCall = mockPrisma.users.update.mock.calls[0][0];
      expect(updateCall.where.user_id).toBe(USER_ID);
      expect(updateCall.data.active).toBe(false);
      expect(updateCall.data.email).toBe(`deleted-${USER_ID}@sacdia.deleted`);
      expect(updateCall.data.name).toBeNull();
      expect(updateCall.data.birthday).toBeNull();
    });

    it('should delete credential account row', async () => {
      await service.deleteAccount(USER_ID, { password: PASSWORD });
      expect(mockPrisma.account.deleteMany).toHaveBeenCalledWith({
        where: { userId: USER_ID },
      });
    });

    it('should write an account_deletion_log entry', async () => {
      await service.deleteAccount(USER_ID, { password: PASSWORD });
      expect(mockPrisma.account_deletion_log.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ user_id: USER_ID }),
        }),
      );
    });

    it('should attempt R2 deletion for existing user_image (fire-and-forget)', async () => {
      mockFileStorage.extractKeyFromPublicUrl.mockReturnValue(
        'profiles/avatar.jpg',
      );
      mockFileStorage.deleteMany.mockResolvedValue(undefined);

      await service.deleteAccount(USER_ID, { password: PASSWORD });

      // Give the fire-and-forget microtask a tick to settle
      await Promise.resolve();

      expect(mockFileStorage.deleteMany).toHaveBeenCalledWith(
        StorageBucketAlias.USER_PROFILES,
        ['profiles/avatar.jpg'],
      );
    });

    it('should NOT throw when R2 deletion fails (fire-and-forget)', async () => {
      mockFileStorage.extractKeyFromPublicUrl.mockReturnValue(
        'profiles/avatar.jpg',
      );
      mockFileStorage.deleteMany.mockRejectedValue(new Error('R2 down'));

      await expect(
        service.deleteAccount(USER_ID, { password: PASSWORD }),
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
        service.deleteAccount(USER_ID, { password: PASSWORD }),
      ).rejects.toMatchObject({ code: ErrorCode.AUTH_ACCOUNT_NOT_FOUND });
    });

    it('should throw BadRequestException when account is already deleted', async () => {
      mockPrisma.users.findUnique.mockResolvedValue({
        user_id: USER_ID,
        email: `deleted-${USER_ID}@sacdia.deleted`,
        active: false,
        user_image: null,
      });

      await expect(
        service.deleteAccount(USER_ID, { password: PASSWORD }),
      ).rejects.toMatchObject({ code: ErrorCode.AUTH_ACCOUNT_ALREADY_DELETED });
    });

    it('should throw UnauthorizedException when password is wrong', async () => {
      mockPrisma.users.findUnique.mockResolvedValue({
        user_id: USER_ID,
        email: 'user@sacdia.app',
        active: true,
        user_image: null,
      });
      mockPrisma.account.findMany.mockResolvedValue([credentialAccount]);
      (bcryptMock.compare as jest.Mock).mockResolvedValue(false);

      await expect(
        service.deleteAccount(USER_ID, { password: PASSWORD }),
      ).rejects.toMatchObject({ code: ErrorCode.AUTH_INVALID_PASSWORD });
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
    mockPrisma.account.findMany.mockResolvedValue([credentialAccount]);
    (bcryptMock.compare as jest.Mock).mockResolvedValue(true);
    mockPrisma.session.deleteMany.mockResolvedValue({ count: 0 });
    mockPrisma.user_fcm_tokens.updateMany.mockResolvedValue({ count: 0 });
    mockPrisma.users.update.mockResolvedValue({});
    mockPrisma.account.deleteMany.mockResolvedValue({ count: 0 });
    mockPrisma.account_deletion_log.create.mockResolvedValue({});

    await service.deleteAccount(USER_ID, { password: PASSWORD });

    // Confirm $transaction was called once
    expect(mockPrisma.$transaction).toHaveBeenCalledTimes(1);
  });

  describe('re-authentication with a provider id token', () => {
    const activeUser = {
      user_id: USER_ID,
      email: 'ana@example.com',
      active: true,
      user_image: null,
    };

    it('deletes when the id token belongs to a linked account', async () => {
      mockPrisma.users.findUnique.mockResolvedValue(activeUser);
      mockPrisma.account.findMany.mockResolvedValue([
        {
          providerId: 'google',
          accountId: 'g-1',
          password: null,
          refreshToken: null,
        },
      ]);
      mockGoogleVerifier.verify.mockResolvedValue({
        provider: 'google',
        sub: 'g-1',
        email: 'ana@example.com',
        emailVerified: true,
      });

      await expect(
        service.deleteAccount(
          USER_ID,
          { provider: 'google', idToken: 't', nonce: 'n' },
          '1.1.1.1',
        ),
      ).resolves.toBeUndefined();

      expect(mockGoogleVerifier.verify).toHaveBeenCalledWith('t', 'n');
      expect(mockPrisma.users.update).toHaveBeenCalled();
    });

    it('rejects an id token for a different subject', async () => {
      mockPrisma.users.findUnique.mockResolvedValue(activeUser);
      mockPrisma.account.findMany.mockResolvedValue([
        {
          providerId: 'google',
          accountId: 'g-1',
          password: null,
          refreshToken: null,
        },
      ]);
      mockGoogleVerifier.verify.mockResolvedValue({
        provider: 'google',
        sub: 'someone-else',
        email: 'x@example.com',
        emailVerified: true,
      });

      await expect(
        service.deleteAccount(USER_ID, {
          provider: 'google',
          idToken: 't',
          nonce: 'n',
        }),
      ).rejects.toMatchObject({ code: ErrorCode.AUTH_INVALID_TOKEN });
      expect(mockPrisma.users.update).not.toHaveBeenCalled();
    });

    it('rejects a provider that is not linked to the account', async () => {
      mockPrisma.users.findUnique.mockResolvedValue(activeUser);
      mockPrisma.account.findMany.mockResolvedValue([credentialAccount]);
      mockAppleVerifier.verify.mockResolvedValue({
        provider: 'apple',
        sub: 'a-1',
        email: 'ana@example.com',
        emailVerified: true,
      });

      await expect(
        service.deleteAccount(USER_ID, {
          provider: 'apple',
          idToken: 't',
          nonce: 'n',
        }),
      ).rejects.toMatchObject({ code: ErrorCode.AUTH_INVALID_TOKEN });
    });

    it('rejects a password re-auth when the account has no password', async () => {
      mockPrisma.users.findUnique.mockResolvedValue(activeUser);
      mockPrisma.account.findMany.mockResolvedValue([
        {
          providerId: 'google',
          accountId: 'g-1',
          password: null,
          refreshToken: null,
        },
      ]);

      await expect(
        service.deleteAccount(USER_ID, { password: PASSWORD }),
      ).rejects.toMatchObject({ code: ErrorCode.AUTH_INVALID_PASSWORD });
    });
  });

  describe('Apple token revocation', () => {
    const activeUser = {
      user_id: USER_ID,
      email: 'ana@example.com',
      active: true,
      user_image: null,
    };

    beforeEach(() => {
      mockPrisma.users.findUnique.mockResolvedValue(activeUser);
      mockPrisma.account.findMany.mockResolvedValue([
        {
          providerId: 'apple',
          accountId: 'a-1',
          password: null,
          refreshToken: 'rt-1',
        },
      ]);
      mockAppleVerifier.verify.mockResolvedValue({
        provider: 'apple',
        sub: 'a-1',
        email: 'ana@example.com',
        emailVerified: true,
      });
    });

    it('revokes the Apple refresh token before deleting', async () => {
      mockAppleTokens.revoke.mockResolvedValue(undefined);
      await service.deleteAccount(USER_ID, {
        provider: 'apple',
        idToken: 't',
        nonce: 'n',
      });
      expect(mockAppleTokens.revoke).toHaveBeenCalledWith('rt-1');
      expect(mockPrisma.$transaction).toHaveBeenCalled();
    });

    it('still deletes when the revoke fails', async () => {
      mockAppleTokens.revoke.mockRejectedValue(
        new Error('Apple token endpoint 400'),
      );
      await expect(
        service.deleteAccount(USER_ID, {
          provider: 'apple',
          idToken: 't',
          nonce: 'n',
        }),
      ).resolves.toBeUndefined();
      expect(mockPrisma.$transaction).toHaveBeenCalled();
    });
  });

  describe('session and TOTP cleanup', () => {
    beforeEach(() => {
      mockPrisma.users.findUnique.mockResolvedValue({
        user_id: USER_ID,
        email: 'user@sacdia.app',
        active: true,
        user_image: null,
      });
      mockPrisma.account.findMany.mockResolvedValue([credentialAccount]);
      (bcryptMock.compare as jest.Mock).mockResolvedValue(true);
    });

    it('deletes the TOTP secret row inside the transaction', async () => {
      await service.deleteAccount(USER_ID, { password: PASSWORD });

      expect(mockPrisma.verification.deleteMany).toHaveBeenCalledWith({
        where: { identifier: totpIdentifier(USER_ID) },
      });
      expect(
        mockPrisma.verification.deleteMany.mock.invocationCallOrder[0],
      ).toBeGreaterThan(mockPrisma.$transaction.mock.invocationCallOrder[0]);
    });

    it('blacklists every access JWT of the user after the transaction', async () => {
      await service.deleteAccount(USER_ID, { password: PASSWORD });

      expect(mockTokenBlacklist.blacklistAllUserTokens).toHaveBeenCalledWith(
        USER_ID,
        28800,
      );
      expect(
        mockTokenBlacklist.blacklistAllUserTokens.mock.invocationCallOrder[0],
      ).toBeGreaterThan(mockPrisma.$transaction.mock.invocationCallOrder[0]);
    });

    it('does not blacklist when the transaction fails', async () => {
      mockPrisma.$transaction.mockRejectedValueOnce(new Error('db down'));

      await expect(
        service.deleteAccount(USER_ID, { password: PASSWORD }),
      ).rejects.toThrow('db down');
      expect(mockTokenBlacklist.blacklistAllUserTokens).not.toHaveBeenCalled();
    });

    it('still resolves and logs when the blacklist fails', async () => {
      mockTokenBlacklist.blacklistAllUserTokens.mockRejectedValueOnce(
        new Error('redis down'),
      );
      const logError = jest
        .spyOn((service as any).logger, 'error')
        .mockImplementation(() => undefined);

      await expect(
        service.deleteAccount(USER_ID, { password: PASSWORD }),
      ).resolves.toBeUndefined();

      expect(logError).toHaveBeenCalledTimes(1);
      expect(logError.mock.calls[0][0]).toContain(USER_ID);
    });
  });
});
