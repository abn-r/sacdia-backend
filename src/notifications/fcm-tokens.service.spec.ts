import { Test, TestingModule } from '@nestjs/testing';
import { ErrorCode } from '../common/errors/error-codes';
import { PrismaService } from '../prisma/prisma.service';
import { FcmTokensService } from './fcm-tokens.service';

/**
 * Helper that wraps a per-test transaction mock.
 * The callback passed to $transaction receives the same inner mock so tests
 * can configure findFirst / create / update / findMany / deleteMany on it.
 */
function buildTxMock(inner: Record<string, unknown>) {
  return jest
    .fn()
    .mockImplementation((fn: (tx: typeof inner) => unknown) => fn(inner));
}

describe('FcmTokensService', () => {
  let service: FcmTokensService;

  // Inner mock used inside the $transaction callback
  const txMock = {
    linked_devices: {
      findFirst: jest.fn(),
      update: jest.fn(),
    },
    user_fcm_tokens: {
      findFirst: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
      create: jest.fn(),
      findMany: jest.fn(),
      deleteMany: jest.fn(),
    },
  };

  // Top-level mock (methods called outside transactions)
  const mockPrismaService = {
    user_fcm_tokens: {
      findFirst: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
      create: jest.fn(),
      findMany: jest.fn(),
      deleteMany: jest.fn(),
    },
    $transaction: buildTxMock(txMock),
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
    // Reset $transaction to default passthrough after each test
    mockPrismaService.$transaction = buildTxMock(txMock);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  // ---------------------------------------------------------------------------
  // registerToken — original behavior
  // ---------------------------------------------------------------------------
  describe('registerToken — upsert behavior', () => {
    it('should update existing token and reassign user', async () => {
      txMock.user_fcm_tokens.findFirst.mockResolvedValue({
        fcm_token_id: 'token-id',
        user_id: 'old-user',
      });
      txMock.user_fcm_tokens.update.mockResolvedValue({
        fcm_token_id: 'token-id',
        user_id: 'new-user',
      });
      // Prune query: top 5 tokens (already within limit)
      txMock.user_fcm_tokens.findMany.mockResolvedValue([
        { fcm_token_id: 'token-id' },
      ]);
      txMock.user_fcm_tokens.deleteMany.mockResolvedValue({ count: 0 });

      const result = await service.registerToken('new-user', {
        token: 'fcm-token',
      });

      expect(txMock.user_fcm_tokens.update).toHaveBeenCalledWith({
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
      txMock.user_fcm_tokens.findFirst.mockResolvedValue(null);
      txMock.user_fcm_tokens.create.mockResolvedValue({
        fcm_token_id: 'new-token-id',
        user_id: 'user-1',
      });
      txMock.user_fcm_tokens.findMany.mockResolvedValue([
        { fcm_token_id: 'new-token-id' },
      ]);
      txMock.user_fcm_tokens.deleteMany.mockResolvedValue({ count: 0 });

      const result = await service.registerToken('user-1', {
        token: 'fcm-token',
      });

      expect(txMock.user_fcm_tokens.create).toHaveBeenCalled();
      expect(result.user_id).toBe('user-1');
    });
  });

  // ---------------------------------------------------------------------------
  // registerToken — token cap (Step 7)
  // ---------------------------------------------------------------------------
  // ---------------------------------------------------------------------------
  // registerToken — a linked device (3b)
  // ---------------------------------------------------------------------------
  describe('registerToken — linked device (3b)', () => {
    const CHILD = 'child-1';

    beforeEach(() => {
      txMock.user_fcm_tokens.findFirst.mockResolvedValue(null);
      txMock.user_fcm_tokens.create.mockResolvedValue({
        fcm_token_id: 'tok-new',
        user_id: CHILD,
      });
      txMock.user_fcm_tokens.findMany.mockResolvedValue([
        { fcm_token_id: 'tok-new' },
      ]);
      txMock.user_fcm_tokens.deleteMany.mockResolvedValue({ count: 0 });
    });

    it('links the registered token to the ACTIVE device row of the child', async () => {
      txMock.linked_devices.findFirst.mockResolvedValue({ fcm_token_id: null });

      await service.registerToken(
        CHILD,
        { token: 'fcm' },
        { linkedDeviceId: 'dev-1' },
      );

      expect(txMock.linked_devices.findFirst).toHaveBeenCalledWith({
        where: {
          linked_device_id: 'dev-1',
          dependent_user_id: CHILD,
          revoked_at: null,
        },
        select: { fcm_token_id: true },
      });
      expect(txMock.linked_devices.update).toHaveBeenCalledWith({
        where: { linked_device_id: 'dev-1' },
        data: { fcm_token_id: 'tok-new' },
      });
    });

    it('a rotated token replaces the old one, which is deactivated', async () => {
      txMock.linked_devices.findFirst.mockResolvedValue({
        fcm_token_id: 'tok-old',
      });

      await service.registerToken(
        CHILD,
        { token: 'fcm' },
        { linkedDeviceId: 'dev-1' },
      );

      expect(txMock.user_fcm_tokens.updateMany).toHaveBeenCalledWith({
        where: { fcm_token_id: 'tok-old', user_id: CHILD },
        data: { active: false },
      });
    });

    it('re-registering the same token does not deactivate it', async () => {
      txMock.linked_devices.findFirst.mockResolvedValue({
        fcm_token_id: 'tok-new',
      });

      await service.registerToken(
        CHILD,
        { token: 'fcm' },
        { linkedDeviceId: 'dev-1' },
      );

      expect(txMock.user_fcm_tokens.updateMany).not.toHaveBeenCalled();
    });

    it('a revoked or foreign device row links nothing (the token is still registered for the child)', async () => {
      txMock.linked_devices.findFirst.mockResolvedValue(null);

      await service.registerToken(
        CHILD,
        { token: 'fcm' },
        { linkedDeviceId: 'dev-gone' },
      );

      expect(txMock.linked_devices.update).not.toHaveBeenCalled();
      expect(txMock.user_fcm_tokens.create).toHaveBeenCalled();
    });

    it('without a device context nothing about devices is read (adult / teen unchanged)', async () => {
      await service.registerToken(CHILD, { token: 'fcm' });
      await service.registerToken(
        CHILD,
        { token: 'fcm' },
        { linkedDeviceId: null },
      );

      expect(txMock.linked_devices.findFirst).not.toHaveBeenCalled();
    });

    it('the 5 token cap and the re-register move are untouched for a device', async () => {
      txMock.linked_devices.findFirst.mockResolvedValue({ fcm_token_id: null });
      txMock.user_fcm_tokens.findFirst.mockResolvedValue({
        fcm_token_id: 'tok-new',
        user_id: 'guardian-phone-owner',
      });
      txMock.user_fcm_tokens.update.mockResolvedValue({
        fcm_token_id: 'tok-new',
        user_id: CHILD,
      });

      await service.registerToken(
        CHILD,
        { token: 'shared-phone-token' },
        { linkedDeviceId: 'dev-1' },
      );

      // The existing "move the token to the caller" behavior (shared phone).
      expect(txMock.user_fcm_tokens.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ user_id: CHILD, active: true }),
        }),
      );
      expect(txMock.user_fcm_tokens.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ take: 5 }),
      );
    });
  });

  describe('registerToken — token cap enforcement', () => {
    it('should NOT prune when user has fewer than 5 active tokens', async () => {
      txMock.user_fcm_tokens.findFirst.mockResolvedValue(null);
      txMock.user_fcm_tokens.create.mockResolvedValue({
        fcm_token_id: 'tok-3',
        user_id: 'user-cap',
      });
      // Only 3 active tokens returned after create
      txMock.user_fcm_tokens.findMany.mockResolvedValue([
        { fcm_token_id: 'tok-1' },
        { fcm_token_id: 'tok-2' },
        { fcm_token_id: 'tok-3' },
      ]);
      txMock.user_fcm_tokens.deleteMany.mockResolvedValue({ count: 0 });

      await service.registerToken('user-cap', { token: 'new-fcm' });

      // deleteMany must be called but with notIn covering all 3 → count 0 (no pruning)
      expect(txMock.user_fcm_tokens.deleteMany).toHaveBeenCalledWith({
        where: {
          user_id: 'user-cap',
          active: true,
          fcm_token_id: { notIn: ['tok-1', 'tok-2', 'tok-3'] },
        },
      });
    });

    it('should prune oldest token when user already has 5 and registers a new one', async () => {
      const top5Ids = ['tok-new', 'tok-4', 'tok-3', 'tok-2', 'tok-1'];

      txMock.user_fcm_tokens.findFirst.mockResolvedValue(null);
      txMock.user_fcm_tokens.create.mockResolvedValue({
        fcm_token_id: 'tok-new',
        user_id: 'user-cap',
      });
      // After create there are 6 active tokens; findMany top-5 returns 5 most recent
      txMock.user_fcm_tokens.findMany.mockResolvedValue(
        top5Ids.map((id) => ({ fcm_token_id: id })),
      );
      // deleteMany removes 1 (tok-oldest, which is NOT in top5Ids)
      txMock.user_fcm_tokens.deleteMany.mockResolvedValue({ count: 1 });

      await service.registerToken('user-cap', { token: 'brand-new-token' });

      expect(txMock.user_fcm_tokens.deleteMany).toHaveBeenCalledWith({
        where: {
          user_id: 'user-cap',
          active: true,
          fcm_token_id: { notIn: top5Ids },
        },
      });
    });

    it('should NOT prune when re-registering an existing token (count stays same)', async () => {
      const existingIds = ['tok-A', 'tok-B', 'tok-C', 'tok-D', 'tok-E'];

      // Token already exists — update path
      txMock.user_fcm_tokens.findFirst.mockResolvedValue({
        fcm_token_id: 'tok-A',
        user_id: 'user-cap',
      });
      txMock.user_fcm_tokens.update.mockResolvedValue({
        fcm_token_id: 'tok-A',
        user_id: 'user-cap',
      });
      // Still only 5 active tokens after update
      txMock.user_fcm_tokens.findMany.mockResolvedValue(
        existingIds.map((id) => ({ fcm_token_id: id })),
      );
      txMock.user_fcm_tokens.deleteMany.mockResolvedValue({ count: 0 });

      await service.registerToken('user-cap', { token: 'existing-fcm' });

      // notIn contains all 5 → nothing to delete
      expect(txMock.user_fcm_tokens.deleteMany).toHaveBeenCalledWith({
        where: {
          user_id: 'user-cap',
          active: true,
          fcm_token_id: { notIn: existingIds },
        },
      });
      expect(txMock.user_fcm_tokens.deleteMany).toHaveBeenCalledTimes(1);
      // Confirm no prune happened (count 0)
      const deleteCall =
        txMock.user_fcm_tokens.deleteMany.mock.results[0].value;
      await expect(deleteCall).resolves.toEqual({ count: 0 });
    });
  });

  // ---------------------------------------------------------------------------
  // unregisterToken
  // ---------------------------------------------------------------------------
  describe('unregisterToken', () => {
    it('should throw NotFoundException when token does not exist', async () => {
      mockPrismaService.user_fcm_tokens.findFirst.mockResolvedValue(null);

      await expect(
        service.unregisterToken('missing-token', 'user-1'),
      ).rejects.toMatchObject({ code: ErrorCode.FCM_TOKEN_NOT_FOUND });
    });

    it('should throw ForbiddenException when token belongs to another user', async () => {
      mockPrismaService.user_fcm_tokens.findFirst.mockResolvedValue({
        token: 'fcm-token',
        user_id: 'other-user',
      });

      await expect(
        service.unregisterToken('fcm-token', 'user-1'),
      ).rejects.toMatchObject({ code: ErrorCode.FCM_TOKEN_FORBIDDEN });
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
