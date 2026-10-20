import { Logger } from '@nestjs/common';
import { ErrorCode } from '../common/errors/error-codes';
import {
  COMMIT_POLL_DELAYS_MS,
  LinkedDevicesService,
} from './linked-devices.service';

const CHILD = '11111111-1111-4111-8111-111111111111';
const G1 = '22222222-2222-4222-8222-222222222222';
const G2 = '33333333-3333-4333-8333-333333333333';
const DEV = '44444444-4444-4444-8444-444444444444';

const NOW = new Date('2026-10-20T12:00:00.000Z');

function devRow(over: Record<string, unknown> = {}) {
  return {
    linked_device_id: DEV,
    label: 'Tablet de Ana',
    platform: 'android',
    app_version: '2.4.0',
    paired_at: new Date('2026-10-01T00:00:00Z'),
    last_seen_at: null,
    absolute_expires_at: new Date('2027-03-30T00:00:00Z'),
    revoked_at: null,
    revoked_reason: null,
    paired_by: { name: 'María', paternal_last_name: 'Pérez' },
    ...over,
  };
}

describe('LinkedDevicesService', () => {
  let tx: Record<string, any>;
  let prisma: Record<string, any>;
  let revocation: {
    revokeInTx: jest.Mock;
    bumpAfterCommit: jest.Mock;
    onAutoRevoked: jest.Mock;
  };
  let powers: { assertVerifiedGuardian: jest.Mock };
  let security: { onDeviceRevoked: jest.Mock };
  let service: LinkedDevicesService;
  const originalDelays = [...COMMIT_POLL_DELAYS_MS];

  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    COMMIT_POLL_DELAYS_MS.splice(0, COMMIT_POLL_DELAYS_MS.length, 0);
    tx = {
      $executeRaw: jest.fn().mockResolvedValue(0),
      linked_devices: {
        findFirst: jest.fn(),
        findUniqueOrThrow: jest.fn(),
      },
    };
    prisma = {
      $transaction: jest.fn((fn: (t: unknown) => unknown) => fn(tx)),
      linked_devices: { findMany: jest.fn().mockResolvedValue([]) },
    };
    revocation = {
      revokeInTx: jest.fn().mockResolvedValue([]),
      bumpAfterCommit: jest.fn().mockResolvedValue(undefined),
      onAutoRevoked: jest.fn(),
    };
    powers = {
      assertVerifiedGuardian: jest.fn().mockResolvedValue({
        guardianship_id: 'gs-1',
        dependent_user_id: CHILD,
        guardian_user_id: G1,
      }),
    };
    security = { onDeviceRevoked: jest.fn().mockResolvedValue(undefined) };
    service = new LinkedDevicesService(
      prisma as never,
      revocation as never,
      powers as never,
      security as never,
    );
  });

  afterEach(() => {
    COMMIT_POLL_DELAYS_MS.splice(
      0,
      COMMIT_POLL_DELAYS_MS.length,
      ...originalDelays,
    );
    jest.restoreAllMocks();
  });

  const flush = () => new Promise<void>((r) => setTimeout(r, 20));

  describe('list', () => {
    it('lists devices for ANY verified guardian (checked through the powers policy)', async () => {
      prisma.linked_devices.findMany.mockResolvedValue([
        devRow(),
        devRow({
          linked_device_id: 'dev-2',
          revoked_at: new Date('2026-10-10T00:00:00Z'),
          revoked_reason: 'guardian',
        }),
      ]);

      const result = await service.list(G2, CHILD);

      expect(powers.assertVerifiedGuardian).toHaveBeenCalledWith(G2, CHILD);
      expect(result.limits).toEqual({ max_devices: 2 });
      expect(result.devices).toEqual([
        {
          linked_device_id: DEV,
          label: 'Tablet de Ana',
          platform: 'android',
          app_version: '2.4.0',
          paired_at: '2026-10-01T00:00:00.000Z',
          paired_by_display_name: 'María Pérez',
          last_seen_at: null,
          absolute_expires_at: '2027-03-30T00:00:00.000Z',
          status: 'active',
          revoked_at: null,
          revoked_reason: null,
        },
        expect.objectContaining({
          linked_device_id: 'dev-2',
          status: 'revoked',
          revoked_at: '2026-10-10T00:00:00.000Z',
          revoked_reason: 'guardian',
        }),
      ]);
    });

    it('lists active devices and those revoked in the last 30 days only', async () => {
      jest.useFakeTimers({ now: NOW });
      try {
        await service.list(G1, CHILD);
      } finally {
        jest.useRealTimers();
      }

      const where = prisma.linked_devices.findMany.mock.calls[0][0].where;
      expect(where.dependent_user_id).toBe(CHILD);
      expect(where.OR).toEqual([
        { revoked_at: null },
        { revoked_at: { gte: new Date('2026-09-20T12:00:00.000Z') } },
      ]);
    });

    it('a pending guardian or a stranger never reaches the query', async () => {
      powers.assertVerifiedGuardian.mockRejectedValue(
        Object.assign(new Error('403'), {
          code: ErrorCode.GUARDIANSHIP_CONSENT_NOT_VERIFIED,
        }),
      );

      await expect(service.list(G1, CHILD)).rejects.toMatchObject({
        code: ErrorCode.GUARDIANSHIP_CONSENT_NOT_VERIFIED,
      });
      expect(prisma.linked_devices.findMany).not.toHaveBeenCalled();
    });
  });

  describe('revoke (guardian)', () => {
    const arrangeActive = () => {
      tx.linked_devices.findFirst.mockResolvedValue({
        linked_device_id: DEV,
        revoked_at: null,
        revoked_reason: null,
      });
      revocation.revokeInTx.mockResolvedValue([
        {
          linkedDeviceId: DEV,
          dependentUserId: CHILD,
          label: 'Tablet de Ana',
          guardianshipId: 'gs-1',
          pairedByUserId: G1,
          platform: 'android',
          sessionId: 'sid',
        },
      ]);
      tx.linked_devices.findUniqueOrThrow.mockResolvedValue({
        revoked_at: NOW,
        revoked_reason: 'guardian',
      });
    };

    it('revokes under the dependent lock with reason guardian, then bumps the epoch and tells the OTHER guardians', async () => {
      arrangeActive();

      const result = await service.revoke(G2, CHILD, DEV);

      expect(tx.$executeRaw).toHaveBeenCalled();
      expect(revocation.revokeInTx).toHaveBeenCalledWith(
        tx,
        { linked_device_id: DEV },
        { by: G2, reason: 'guardian' },
      );
      expect(result).toEqual({
        linked_device_id: DEV,
        revoked_at: NOW.toISOString(),
        revoked_reason: 'guardian',
      });
      expect(revocation.bumpAfterCommit).toHaveBeenCalledTimes(1);
      expect(security.onDeviceRevoked).toHaveBeenCalledWith({
        dependentUserId: CHILD,
        label: 'Tablet de Ana',
        excludeUserId: G2,
        reason: 'guardian',
      });
    });

    it('is idempotent: a device that is already revoked answers the same 200 and writes nothing', async () => {
      tx.linked_devices.findFirst.mockResolvedValue({
        linked_device_id: DEV,
        revoked_at: NOW,
        revoked_reason: 'admin',
      });

      const result = await service.revoke(G1, CHILD, DEV);

      expect(result).toEqual({
        linked_device_id: DEV,
        revoked_at: NOW.toISOString(),
        revoked_reason: 'admin',
      });
      expect(revocation.revokeInTx).not.toHaveBeenCalled();
      expect(revocation.bumpAfterCommit).not.toHaveBeenCalled();
      expect(security.onDeviceRevoked).not.toHaveBeenCalled();
    });

    it('a device of another family (or unknown) is 404 DEVICE_NOT_FOUND', async () => {
      tx.linked_devices.findFirst.mockResolvedValue(null);

      await expect(service.revoke(G1, CHILD, DEV)).rejects.toMatchObject({
        code: ErrorCode.DEVICE_NOT_FOUND,
        status: 404,
      });
      expect(tx.linked_devices.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { linked_device_id: DEV, dependent_user_id: CHILD },
        }),
      );
    });

    it('only a VERIFIED guardian may revoke (pending 403, stranger 404 come from the policy before any write)', async () => {
      powers.assertVerifiedGuardian.mockRejectedValue(
        Object.assign(new Error('404'), {
          code: ErrorCode.GUARDIANSHIP_NOT_FOUND,
        }),
      );

      await expect(service.revoke(G1, CHILD, DEV)).rejects.toMatchObject({
        code: ErrorCode.GUARDIANSHIP_NOT_FOUND,
      });
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('a failing notice never fails the revoke', async () => {
      arrangeActive();
      security.onDeviceRevoked.mockRejectedValue(new Error('push down'));

      await expect(service.revoke(G1, CHILD, DEV)).resolves.toMatchObject({
        revoked_reason: 'guardian',
      });
      await flush();
    });

    it('the admin entry revokes with reason admin and the admin as actor', async () => {
      arrangeActive();
      tx.linked_devices.findUniqueOrThrow.mockResolvedValue({
        revoked_at: NOW,
        revoked_reason: 'admin',
      });

      const result = await service.revokeAsAdmin('admin-1', CHILD, DEV);

      expect(powers.assertVerifiedGuardian).not.toHaveBeenCalled();
      expect(revocation.revokeInTx).toHaveBeenCalledWith(
        tx,
        { linked_device_id: DEV },
        { by: 'admin-1', reason: 'admin' },
      );
      expect(result.revoked_reason).toBe('admin');
    });
  });

  describe('revokeByLogout', () => {
    it('revokes with device_logout and tells the guardians', async () => {
      revocation.revokeInTx.mockResolvedValue([
        {
          linkedDeviceId: DEV,
          dependentUserId: CHILD,
          label: 'Tablet de Ana',
        },
      ]);

      await service.revokeByLogout(DEV);

      expect(revocation.revokeInTx).toHaveBeenCalledWith(
        tx,
        { linked_device_id: DEV },
        { by: null, reason: 'device_logout' },
      );
      expect(revocation.bumpAfterCommit).toHaveBeenCalled();
      expect(security.onDeviceRevoked).toHaveBeenCalledWith({
        dependentUserId: CHILD,
        label: 'Tablet de Ana',
        excludeUserId: undefined,
        reason: 'device_logout',
      });
    });

    it('does nothing when the device was already revoked', async () => {
      revocation.revokeInTx.mockResolvedValue([]);

      await service.revokeByLogout(DEV);

      expect(revocation.bumpAfterCommit).not.toHaveBeenCalled();
      expect(security.onDeviceRevoked).not.toHaveBeenCalled();
    });
  });

  describe("the LINKED_DEVICE_REVOKER port (inside somebody else's transaction)", () => {
    const revokedDevice = {
      linkedDeviceId: DEV,
      dependentUserId: CHILD,
      label: 'Tablet de Ana',
    };

    it("revokeAllForDependent revokes every active device of the child in the CALLER's transaction and returns the count", async () => {
      revocation.revokeInTx.mockResolvedValue([
        revokedDevice,
        { ...revokedDevice, linkedDeviceId: 'dev-2' },
      ]);
      const callerTx = {} as never;

      const count = await service.revokeAllForDependent(
        callerTx,
        CHILD,
        'teen_login_enabled',
      );

      expect(count).toBe(2);
      expect(revocation.revokeInTx).toHaveBeenCalledWith(
        callerTx,
        { dependent_user_id: CHILD },
        { by: null, reason: 'teen_login_enabled' },
      );
      // It never opens a transaction of its own.
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('revokeByGuardianship revokes only the devices paired through that guardianship', async () => {
      revocation.revokeInTx.mockResolvedValue([revokedDevice]);
      const callerTx = {} as never;

      const count = await service.revokeByGuardianship(
        callerTx,
        'gs-1',
        'guardianship_revoked',
      );

      expect(count).toBe(1);
      expect(revocation.revokeInTx).toHaveBeenCalledWith(
        callerTx,
        { guardianship_id: 'gs-1' },
        { by: null, reason: 'guardianship_revoked' },
      );
    });

    it('returns 0 and announces nothing when there is no device', async () => {
      revocation.revokeInTx.mockResolvedValue([]);

      await expect(
        service.revokeAllForDependent({} as never, CHILD, 'dependent_frozen'),
      ).resolves.toBe(0);
      await flush();
      expect(prisma.linked_devices.findMany).not.toHaveBeenCalled();
      expect(security.onDeviceRevoked).not.toHaveBeenCalled();
    });

    it('tells the remaining guardians once the revoke is VISIBLE as committed, and bumps the epoch', async () => {
      revocation.revokeInTx.mockResolvedValue([revokedDevice]);
      prisma.linked_devices.findMany.mockResolvedValue([
        { linked_device_id: DEV },
      ]);

      await service.revokeByGuardianship(
        {} as never,
        'gs-1',
        'guardianship_revoked',
      );
      await flush();

      expect(prisma.linked_devices.findMany).toHaveBeenCalledWith({
        where: { linked_device_id: { in: [DEV] }, revoked_at: { not: null } },
        select: { linked_device_id: true },
      });
      expect(revocation.bumpAfterCommit).toHaveBeenCalledWith([revokedDevice]);
      expect(security.onDeviceRevoked).toHaveBeenCalledWith({
        dependentUserId: CHILD,
        label: 'Tablet de Ana',
        excludeUserId: undefined,
        reason: 'guardianship_revoked',
      });
    });

    it("announces NOTHING when the caller's transaction rolled back (the revoke never becomes visible)", async () => {
      revocation.revokeInTx.mockResolvedValue([revokedDevice]);
      prisma.linked_devices.findMany.mockResolvedValue([]);

      await service.revokeByGuardianship(
        {} as never,
        'gs-1',
        'guardianship_revoked',
      );
      await flush();

      expect(security.onDeviceRevoked).not.toHaveBeenCalled();
      expect(revocation.bumpAfterCommit).not.toHaveBeenCalled();
    });

    it.each([
      ['guardianship_revoked', true],
      ['guardian_account_closed', true],
      ['session_revoked', true],
      ['teen_login_enabled', false],
      ['dependent_frozen', false],
      ['majority', true],
      ['expired', true],
    ] as const)(
      'reason %s notifies the guardians: %s',
      async (reason, notified) => {
        revocation.revokeInTx.mockResolvedValue([revokedDevice]);
        prisma.linked_devices.findMany.mockResolvedValue([
          { linked_device_id: DEV },
        ]);

        await service.revokeAllForDependent({} as never, CHILD, reason);
        await flush();

        expect(security.onDeviceRevoked).toHaveBeenCalledTimes(
          notified ? 1 : 0,
        );
      },
    );
  });
  describe('revokeBySystem (daily sweep: majority and expired)', () => {
    const revokedRow = {
      linkedDeviceId: DEV,
      dependentUserId: CHILD,
      label: 'Tablet de Ana',
    };

    it('majority: revokes ALL devices of the child under the dependent lock, bumps and tells the guardians ONCE', async () => {
      revocation.revokeInTx.mockResolvedValue([revokedRow]);

      const count = await service.revokeBySystem({
        dependentId: CHILD,
        reason: 'majority',
      });
      await flush();

      expect(count).toBe(1);
      expect(tx.$executeRaw).toHaveBeenCalledTimes(1); // lockDependent
      expect(revocation.revokeInTx).toHaveBeenCalledWith(
        tx,
        { dependent_user_id: CHILD },
        { by: null, reason: 'majority' },
      );
      expect(revocation.bumpAfterCommit).toHaveBeenCalledTimes(1);
      expect(security.onDeviceRevoked).toHaveBeenCalledTimes(1);
      expect(security.onDeviceRevoked).toHaveBeenCalledWith({
        dependentUserId: CHILD,
        label: 'Tablet de Ana',
        excludeUserId: undefined,
        reason: 'majority',
      });
    });

    it('expired: only the named device whose cap passed (the where re-checks the cap)', async () => {
      revocation.revokeInTx.mockResolvedValue([revokedRow]);

      await service.revokeBySystem({
        dependentId: CHILD,
        deviceId: DEV,
        reason: 'expired',
        now: NOW,
      });
      await flush();

      expect(revocation.revokeInTx).toHaveBeenCalledWith(
        tx,
        {
          dependent_user_id: CHILD,
          linked_device_id: DEV,
          absolute_expires_at: { lte: NOW },
        },
        { by: null, reason: 'expired' },
      );
      expect(security.onDeviceRevoked).toHaveBeenCalledWith(
        expect.objectContaining({ reason: 'expired' }),
      );
    });

    it('a precondition that fails under the lock revokes and announces nothing', async () => {
      const precondition = jest.fn().mockResolvedValue(false);

      const count = await service.revokeBySystem({
        dependentId: CHILD,
        reason: 'majority',
        precondition,
      });
      await flush();

      expect(precondition).toHaveBeenCalledWith(tx);
      expect(count).toBe(0);
      expect(revocation.revokeInTx).not.toHaveBeenCalled();
      expect(revocation.bumpAfterCommit).not.toHaveBeenCalled();
      expect(security.onDeviceRevoked).not.toHaveBeenCalled();
    });

    it('a concurrent revoker that won the compare-and-set leaves nothing to announce', async () => {
      revocation.revokeInTx.mockResolvedValue([]);

      const count = await service.revokeBySystem({
        dependentId: CHILD,
        reason: 'majority',
      });
      await flush();

      expect(count).toBe(0);
      expect(revocation.bumpAfterCommit).not.toHaveBeenCalled();
      expect(security.onDeviceRevoked).not.toHaveBeenCalled();
    });
  });

  describe('auto-revoke announcements (W6 ruling)', () => {
    const revokedRow = {
      linkedDeviceId: DEV,
      dependentUserId: CHILD,
      guardianshipId: 'gs-1',
      pairedByUserId: G1,
      label: 'Tablet de Ana',
      platform: 'android',
      sessionId: 'sid-1',
    };
    const listener = () => {
      expect(revocation.onAutoRevoked).toHaveBeenCalledTimes(1);
      return revocation.onAutoRevoked.mock.calls[0][0] as (
        revoked: unknown[],
        reason: string,
      ) => void;
    };

    it('registers ONE listener on the revocation helper', () => {
      expect(revocation.onAutoRevoked).toHaveBeenCalledTimes(1);
      expect(typeof revocation.onAutoRevoked.mock.calls[0][0]).toBe('function');
    });

    it.each(['majority', 'expired'])(
      '%s: the remaining guardians are told, with the reason',
      async (reason) => {
        listener()([revokedRow], reason);
        await flush();

        expect(security.onDeviceRevoked).toHaveBeenCalledTimes(1);
        expect(security.onDeviceRevoked).toHaveBeenCalledWith({
          dependentUserId: CHILD,
          label: 'Tablet de Ana',
          excludeUserId: undefined,
          reason,
        });
      },
    );

    it.each(['teen_login_enabled', 'dependent_frozen'])(
      '%s: nobody is told (an adult action caused it, or it has its own notice)',
      async (reason) => {
        listener()([revokedRow], reason);
        await flush();

        expect(security.onDeviceRevoked).not.toHaveBeenCalled();
      },
    );
  });
});
