import { Test, TestingModule } from '@nestjs/testing';
import * as bcrypt from 'bcryptjs';
import { AccountDeletionService } from './account-deletion.service';
import { PrismaService } from '../prisma/prisma.service';
import {
  FILE_STORAGE_SERVICE,
  StorageBucketAlias,
} from '../common/services/file-storage.service';
import { EmailService } from '../common/email/email.service';
import {
  AppServiceUnavailableException,
  AppUnauthorizedException,
} from '../common/errors/app.exception';
import { ErrorCode } from '../common/errors/error-codes';
import { TokenBlacklistService } from '../common/services/token-blacklist.service';
import { totpIdentifier } from '../better-auth/better-auth.service';
import { GuardianshipLifecycleService } from '../guardianships/guardianship-lifecycle.service';
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
  legal_acceptances: {
    updateMany: jest.fn(),
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

const mockLifecycle = {
  deletionImpact: jest.fn(),
  detachGuardian: jest.fn(),
  afterCommit: jest.fn(),
};

const mockFileStorage = {
  extractKeyFromPublicUrl: jest.fn(),
  deleteMany: jest.fn(),
};

const mockEmailService = {
  sendAccountDeletionConfirmed: jest.fn().mockResolvedValue(undefined),
};

/** A rejected re-auth must not have touched Apple, the DB or the blacklist. */
function expectNothingRevokedOrDeleted() {
  expect(mockAppleTokens.revoke).not.toHaveBeenCalled();
  expect(mockPrisma.$transaction).not.toHaveBeenCalled();
  expect(mockTokenBlacklist.blacklistAllUserTokens).not.toHaveBeenCalled();
}

describe('AccountDeletionService', () => {
  let service: AccountDeletionService;

  beforeEach(async () => {
    jest.clearAllMocks();

    // Default: a user without dependents.
    mockLifecycle.deletionImpact.mockResolvedValue({ dependents: [] });
    mockLifecycle.detachGuardian.mockResolvedValue([]);
    mockLifecycle.afterCommit.mockResolvedValue(undefined);

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
        { provide: GuardianshipLifecycleService, useValue: mockLifecycle },
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

    it('should erase IP and user agent from legal acceptances', async () => {
      await service.deleteAccount(USER_ID, { password: PASSWORD });
      expect(mockPrisma.legal_acceptances.updateMany).toHaveBeenCalledWith({
        where: {
          OR: [{ user_id: USER_ID }, { accepted_by_user_id: USER_ID }],
        },
        data: { ip_address: null, user_agent: null },
      });
    });

    it('also erases IP and user agent of acceptances the user made on behalf of a dependent', async () => {
      await service.deleteAccount(USER_ID, { password: PASSWORD });
      // One statement covers both: the guardian's own acceptances and the ones
      // recorded for a minor (user_id = minor, accepted_by_user_id = guardian).
      expect(mockPrisma.legal_acceptances.updateMany).toHaveBeenCalledTimes(1);
      const [{ where }] = mockPrisma.legal_acceptances.updateMany.mock
        .calls[0] as [{ where: { OR: Array<Record<string, string>> } }];
      expect(where.OR).toContainEqual({ accepted_by_user_id: USER_ID });
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
      expectNothingRevokedOrDeleted();
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
      expectNothingRevokedOrDeleted();
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
      expectNothingRevokedOrDeleted();
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
      expectNothingRevokedOrDeleted();
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
      expectNothingRevokedOrDeleted();
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
      expectNothingRevokedOrDeleted();
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
      expect(mockAppleTokens.revoke.mock.invocationCallOrder[0]).toBeLessThan(
        mockPrisma.$transaction.mock.invocationCallOrder[0],
      );
    });

    it('does not revoke when the id token belongs to another subject', async () => {
      mockAppleVerifier.verify.mockResolvedValue({
        provider: 'apple',
        sub: 'someone-else',
        email: 'x@example.com',
        emailVerified: true,
      });

      await expect(
        service.deleteAccount(USER_ID, {
          provider: 'apple',
          idToken: 't',
          nonce: 'n',
        }),
      ).rejects.toMatchObject({ code: ErrorCode.AUTH_INVALID_TOKEN });
      expectNothingRevokedOrDeleted();
    });

    it('does not revoke or delete when the verifier rejects the token', async () => {
      mockAppleVerifier.verify.mockRejectedValue(
        new AppUnauthorizedException(ErrorCode.AUTH_INVALID_TOKEN),
      );

      await expect(
        service.deleteAccount(USER_ID, {
          provider: 'apple',
          idToken: 't',
          nonce: 'n',
        }),
      ).rejects.toMatchObject({ code: ErrorCode.AUTH_INVALID_TOKEN });
      expectNothingRevokedOrDeleted();
    });

    it('does not revoke or delete when the provider is unavailable', async () => {
      mockAppleVerifier.verify.mockRejectedValue(
        new AppServiceUnavailableException(
          ErrorCode.AUTH_OAUTH_PROVIDER_UNAVAILABLE,
        ),
      );

      await expect(
        service.deleteAccount(USER_ID, {
          provider: 'apple',
          idToken: 't',
          nonce: 'n',
        }),
      ).rejects.toMatchObject({
        code: ErrorCode.AUTH_OAUTH_PROVIDER_UNAVAILABLE,
      });
      expectNothingRevokedOrDeleted();
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
        { includeCurrentSecond: true },
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

  // -------------------------------------------------------------------------
  // Guardians: minors in their care (family profiles)
  // -------------------------------------------------------------------------

  describe('guardian with dependents', () => {
    const impact = {
      dependents: [
        { user_id: 'd-1', display_name: 'Ana Pérez', outcome: 'frozen' },
        { user_id: 'd-2', display_name: 'Luis Pérez', outcome: 'club_custody' },
      ],
    };

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

    it('answers 409 AUTH_DELETE_DEPENDENTS_ACK_REQUIRED without the acknowledgment and changes NOTHING', async () => {
      mockLifecycle.deletionImpact.mockResolvedValue(impact);

      const error = await service
        .deleteAccount(USER_ID, { password: PASSWORD })
        .catch((e: any) => e);

      expect(error.code).toBe(ErrorCode.AUTH_DELETE_DEPENDENTS_ACK_REQUIRED);
      expect(error.getStatus()).toBe(409);
      expect(error.getResponse().details).toEqual({ dependents_count: 2 });
      expectNothingRevokedOrDeleted();
      expect(mockLifecycle.detachGuardian).not.toHaveBeenCalled();
      expect(mockPrisma.users.update).not.toHaveBeenCalled();
    });

    it('requires the acknowledgment to be exactly true', async () => {
      mockLifecycle.deletionImpact.mockResolvedValue(impact);
      const error = await service
        .deleteAccount(USER_ID, { password: PASSWORD }, undefined, {
          acknowledgeDependents: false,
        })
        .catch((e: any) => e);
      expect(error.code).toBe(ErrorCode.AUTH_DELETE_DEPENDENTS_ACK_REQUIRED);
    });

    it('checks the acknowledgment only AFTER re-authentication', async () => {
      mockLifecycle.deletionImpact.mockResolvedValue(impact);
      (bcryptMock.compare as jest.Mock).mockResolvedValue(false);

      await expect(
        service.deleteAccount(USER_ID, { password: 'wrong' }),
      ).rejects.toMatchObject({ code: ErrorCode.AUTH_INVALID_PASSWORD });
      // A caller who cannot prove who they are learns nothing about dependents.
      expect(mockLifecycle.deletionImpact).not.toHaveBeenCalled();
    });

    it('with the acknowledgment: detaches the dependents INSIDE the transaction, before anonymizing', async () => {
      const detached = [
        { guardianshipId: 'g-1', dependentUserId: 'd-1', outcome: 'frozen' },
      ];
      mockLifecycle.detachGuardian.mockResolvedValue(detached);

      await service.deleteAccount(
        USER_ID,
        { password: PASSWORD },
        '127.0.0.1',
        {
          acknowledgeDependents: true,
        },
      );

      expect(mockLifecycle.detachGuardian).toHaveBeenCalledWith(
        mockPrisma,
        USER_ID,
        'guardian_account_closed',
      );
      const order = (fn: jest.Mock) => fn.mock.invocationCallOrder[0];
      expect(order(mockPrisma.$transaction)).toBeLessThan(
        order(mockLifecycle.detachGuardian),
      );
      expect(order(mockLifecycle.detachGuardian)).toBeLessThan(
        order(mockPrisma.users.update),
      );
      // Epochs / custody notifications only after the commit.
      expect(mockLifecycle.afterCommit).toHaveBeenCalledWith(detached);
      expect(order(mockLifecycle.afterCommit)).toBeGreaterThan(
        order(mockPrisma.account_deletion_log.create),
      );
    });

    it('rolls back (account NOT deleted) when detaching a dependent fails', async () => {
      mockLifecycle.detachGuardian.mockRejectedValue(new Error('constraint'));

      await expect(
        service.deleteAccount(USER_ID, { password: PASSWORD }, undefined, {
          acknowledgeDependents: true,
        }),
      ).rejects.toThrow('constraint');

      // The failure happens before any anonymization write in the transaction.
      expect(mockPrisma.users.update).not.toHaveBeenCalled();
      expect(mockPrisma.account.deleteMany).not.toHaveBeenCalled();
      expect(mockPrisma.account_deletion_log.create).not.toHaveBeenCalled();
      expect(mockLifecycle.afterCommit).not.toHaveBeenCalled();
      expect(mockTokenBlacklist.blacklistAllUserTokens).not.toHaveBeenCalled();
    });

    it('with dependents: still erases legal acceptance IP/UA, in the SAME transaction after detaching', async () => {
      const detached = [
        { guardianshipId: 'g-1', dependentUserId: 'd-1', outcome: 'frozen' },
      ];
      mockLifecycle.detachGuardian.mockResolvedValue(detached);
      // A distinct tx client proves the writes go through the transaction.
      const tx = {
        session: { deleteMany: jest.fn() },
        user_fcm_tokens: { updateMany: jest.fn() },
        users: { update: jest.fn() },
        verification: { deleteMany: jest.fn() },
        account: { deleteMany: jest.fn() },
        legal_acceptances: { updateMany: jest.fn() },
        account_deletion_log: { create: jest.fn() },
      };
      mockPrisma.$transaction.mockImplementation(
        async (fn: (client: any) => Promise<any>) => fn(tx),
      );

      await service.deleteAccount(
        USER_ID,
        { password: PASSWORD },
        '127.0.0.1',
        { acknowledgeDependents: true },
      );

      expect(mockLifecycle.detachGuardian).toHaveBeenCalledWith(
        tx,
        USER_ID,
        'guardian_account_closed',
      );
      expect(tx.legal_acceptances.updateMany).toHaveBeenCalledWith({
        where: {
          OR: [{ user_id: USER_ID }, { accepted_by_user_id: USER_ID }],
        },
        data: { ip_address: null, user_agent: null },
      });
      expect(mockPrisma.legal_acceptances.updateMany).not.toHaveBeenCalled();
      const order = (fn: jest.Mock) => fn.mock.invocationCallOrder[0];
      expect(order(mockLifecycle.detachGuardian)).toBeLessThan(
        order(tx.legal_acceptances.updateMany),
      );
      expect(order(tx.legal_acceptances.updateMany)).toBeLessThan(
        order(mockLifecycle.afterCommit),
      );
    });

    it('keeps legal acceptance IP/UA when detaching a dependent fails (rollback)', async () => {
      mockLifecycle.detachGuardian.mockRejectedValue(new Error('constraint'));

      await expect(
        service.deleteAccount(USER_ID, { password: PASSWORD }, undefined, {
          acknowledgeDependents: true,
        }),
      ).rejects.toThrow('constraint');

      expect(mockPrisma.legal_acceptances.updateMany).not.toHaveBeenCalled();
    });

    it('does not need the flag when there are no dependents', async () => {
      mockLifecycle.deletionImpact.mockResolvedValue({ dependents: [] });
      await expect(
        service.deleteAccount(USER_ID, { password: PASSWORD }),
      ).resolves.toBeUndefined();
      expect(mockPrisma.users.update).toHaveBeenCalled();
    });

    it('does not even preview the impact when the user already acknowledged', async () => {
      await service.deleteAccount(USER_ID, { password: PASSWORD }, undefined, {
        acknowledgeDependents: true,
      });
      expect(mockLifecycle.deletionImpact).not.toHaveBeenCalled();
    });
  });
});
