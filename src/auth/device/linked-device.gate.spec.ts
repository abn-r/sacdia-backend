import { Logger } from '@nestjs/common';
import { ErrorCode } from '../../common/errors/error-codes';
import {
  DEVICE_GATE_ACTIVE_TTL_MS,
  DEVICE_GATE_INACTIVE_TTL_MS,
  DEVICE_LAST_SEEN_INTERVAL_MS,
  LinkedDeviceGate,
} from './linked-device.gate';

const CHILD = '11111111-1111-4111-8111-111111111111';
const DEVICE = '22222222-2222-4222-8222-222222222222';
const GUARDIANSHIP = '33333333-3333-4333-8333-333333333333';
const SID = 'sid-1';
const INPUT = { dependentId: CHILD, sid: SID, deviceId: DEVICE };

const NOW = new Date('2026-10-20T12:00:00.000Z');
const YEARS = (n: number) => new Date(NOW.getTime() - n * 365.25 * 86_400_000);

interface Overrides {
  device?: Record<string, unknown> | null;
  session?: Record<string, unknown> | null;
  guardianship?: Record<string, unknown>;
  dependent?: Record<string, unknown>;
}

function deviceRow(overrides: Overrides = {}) {
  if (overrides.device === null) return null;
  return {
    linked_device_id: DEVICE,
    guardianship_id: GUARDIANSHIP,
    revoked_at: null,
    absolute_expires_at: new Date(NOW.getTime() + 100 * 86_400_000),
    guardianship: {
      consent_status: 'verified',
      is_custodian: false,
      is_test_data: false,
      revoked_at: null,
      guardian_user_id: 'guardian-1',
      ...overrides.guardianship,
    },
    dependent: {
      active: true,
      birthday: YEARS(9),
      country_id: 1,
      dependent_profile: { frozen_at: null, purged_at: null },
      supervised_login: null,
      ...overrides.dependent,
    },
    ...overrides.device,
  };
}

describe('LinkedDeviceGate', () => {
  let prisma: {
    linked_devices: { findFirst: jest.Mock; updateMany: jest.Mock };
    session: { findFirst: jest.Mock };
  };
  let cache: { get: jest.Mock; set: jest.Mock };
  let epochs: { getEpoch: jest.Mock; initEpoch: jest.Mock };
  let flags: { isEnabled: jest.Mock };
  let policy: { getPolicy: jest.Mock };
  let revocation: {
    revokeStandalone: jest.Mock;
    announceAutoRevoked: jest.Mock;
  };
  let store: Map<string, unknown>;

  const build = () =>
    new LinkedDeviceGate(
      prisma as never,
      cache as never,
      epochs as never,
      flags as never,
      policy as never,
      revocation as never,
    );

  const arrange = (overrides: Overrides = {}) => {
    prisma.linked_devices.findFirst.mockResolvedValue(deviceRow(overrides));
    prisma.session.findFirst.mockResolvedValue(
      overrides.session === null
        ? null
        : {
            expiresAt: new Date(NOW.getTime() + 20 * 86_400_000),
            ...overrides.session,
          },
    );
  };

  beforeEach(() => {
    jest.useFakeTimers({ now: NOW });
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    store = new Map();
    prisma = {
      linked_devices: {
        findFirst: jest.fn(),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      session: { findFirst: jest.fn() },
    };
    cache = {
      get: jest.fn((key: string) => Promise.resolve(store.get(key) ?? null)),
      set: jest.fn((key: string, value: unknown) => {
        // The real cache serializes JSON: prove the payload survives it.
        store.set(key, JSON.parse(JSON.stringify(value)));
        return Promise.resolve();
      }),
    };
    epochs = {
      getEpoch: jest.fn().mockResolvedValue(7),
      initEpoch: jest.fn().mockResolvedValue(8),
    };
    flags = { isEnabled: jest.fn().mockReturnValue(true) };
    policy = {
      getPolicy: jest.fn().mockResolvedValue({
        minSelfLoginAge: 13,
        ageOfMajority: 18,
        timeZone: 'America/Mexico_City',
      }),
    };
    revocation = {
      revokeStandalone: jest.fn().mockResolvedValue([]),
      announceAutoRevoked: jest.fn(),
    };
    arrange();
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  describe('an active device', () => {
    it('lets the request through with the guardianship and the end of its validity', async () => {
      const decision = await build().assertActive(INPUT);

      expect(decision).toEqual({
        active: true,
        linkedDeviceId: DEVICE,
        guardianshipId: GUARDIANSHIP,
        validUntil: NOW.getTime() + 20 * 86_400_000,
      });
    });

    it('reads the row by device + dependent + session (a token cannot name a device it does not own)', async () => {
      await build().assertActive(INPUT);

      expect(prisma.linked_devices.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            linked_device_id: DEVICE,
            dependent_user_id: CHILD,
            session_id: SID,
          },
        }),
      );
      expect(prisma.session.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            id: SID,
            userId: CHILD,
            expiresAt: { gt: expect.any(Date) },
          },
        }),
      );
    });

    it('caches under device:v1:{dependent}:{epoch}:{device} for 30 s', async () => {
      await build().assertActive(INPUT);

      expect(cache.set).toHaveBeenCalledWith(
        `device:v1:${CHILD}:7:${DEVICE}`,
        expect.objectContaining({ active: true }),
        DEVICE_GATE_ACTIVE_TTL_MS,
      );
    });

    it('a second request inside the TTL does not touch the database', async () => {
      const gate = build();
      await gate.assertActive(INPUT);
      prisma.linked_devices.findFirst.mockClear();

      await gate.assertActive(INPUT);

      expect(prisma.linked_devices.findFirst).not.toHaveBeenCalled();
    });

    it('the TTL never passes the end of the device validity', async () => {
      arrange({ session: { expiresAt: new Date(NOW.getTime() + 5_000) } });

      await build().assertActive(INPUT);

      expect(cache.set).toHaveBeenCalledWith(
        expect.any(String),
        expect.anything(),
        5_000,
      );
    });

    it('a cached positive entry is not trusted past its validUntil (no Date revival needed: it is epoch ms)', async () => {
      const gate = build();
      await gate.assertActive(INPUT);
      jest.setSystemTime(NOW.getTime() + 21 * 86_400_000);
      prisma.linked_devices.findFirst.mockClear();
      prisma.session.findFirst.mockResolvedValue(null);

      await expect(gate.assertActive(INPUT)).rejects.toMatchObject({
        code: ErrorCode.AUTH_DEVICE_REVOKED,
      });
      expect(prisma.linked_devices.findFirst).toHaveBeenCalled();
    });
  });

  describe('revoke is immediate (the epoch defeats the cache)', () => {
    it('a revoke moves the epoch: the next request reads the database and is refused', async () => {
      const gate = build();
      await gate.assertActive(INPUT); // cached as active under epoch 7

      // The guardian revokes: row revoked, epoch bumped.
      epochs.getEpoch.mockResolvedValue(9);
      arrange({ device: { revoked_at: new Date(NOW.getTime() - 1000) } });

      await expect(gate.assertActive(INPUT)).rejects.toMatchObject({
        code: ErrorCode.AUTH_DEVICE_REVOKED,
        status: 401,
      });
    });

    it('a missing epoch is a miss: a fresh one is minted BEFORE the read and no payload is read under it', async () => {
      epochs.getEpoch.mockResolvedValue(null);
      store.set(`device:v1:${CHILD}:8:${DEVICE}`, {
        active: true,
        linkedDeviceId: DEVICE,
        guardianshipId: GUARDIANSHIP,
        validUntil: NOW.getTime() + 1e9,
      });

      await build().assertActive(INPUT);

      expect(epochs.initEpoch).toHaveBeenCalledWith(CHILD);
      expect(cache.get).not.toHaveBeenCalled();
      expect(prisma.linked_devices.findFirst).toHaveBeenCalled();
      expect(cache.set).toHaveBeenCalledWith(
        `device:v1:${CHILD}:8:${DEVICE}`,
        expect.anything(),
        expect.any(Number),
      );
    });
  });

  describe('refusals', () => {
    it('flag off: 401 AUTH_DEVICE_REVOKED without any lookup (kill switch, nothing recorded)', async () => {
      flags.isEnabled.mockReturnValue(false);

      await expect(build().assertActive(INPUT)).rejects.toMatchObject({
        code: ErrorCode.AUTH_DEVICE_REVOKED,
        status: 401,
      });
      expect(flags.isEnabled).toHaveBeenCalledWith('linked_device');
      expect(epochs.getEpoch).not.toHaveBeenCalled();
      expect(prisma.linked_devices.findFirst).not.toHaveBeenCalled();
      expect(revocation.revokeStandalone).not.toHaveBeenCalled();
    });

    it('the flag is read every time, never cached: on, then off', async () => {
      const gate = build();
      await gate.assertActive(INPUT);
      flags.isEnabled.mockReturnValue(false);

      await expect(gate.assertActive(INPUT)).rejects.toMatchObject({
        code: ErrorCode.AUTH_DEVICE_REVOKED,
      });
    });

    it('an unknown device / wrong dependent / wrong session is revoked and records nothing', async () => {
      arrange({ device: null });

      await expect(build().assertActive(INPUT)).rejects.toMatchObject({
        code: ErrorCode.AUTH_DEVICE_REVOKED,
      });
      expect(revocation.revokeStandalone).not.toHaveBeenCalled();
    });

    it('an already revoked device is refused and not revoked again', async () => {
      arrange({ device: { revoked_at: NOW } });

      await expect(build().assertActive(INPUT)).rejects.toMatchObject({
        code: ErrorCode.AUTH_DEVICE_REVOKED,
      });
      expect(revocation.revokeStandalone).not.toHaveBeenCalled();
    });

    it('past the absolute cap: 401 AUTH_DEVICE_SESSION_EXPIRED and the row records `expired`', async () => {
      arrange({
        device: { absolute_expires_at: new Date(NOW.getTime() - 1000) },
      });

      await expect(build().assertActive(INPUT)).rejects.toMatchObject({
        code: ErrorCode.AUTH_DEVICE_SESSION_EXPIRED,
        status: 401,
      });
      expect(revocation.revokeStandalone).toHaveBeenCalledWith(
        { linked_device_id: DEVICE, dependent_user_id: CHILD },
        { by: null, reason: 'expired' },
      );
    });

    it('a deleted / expired / foreign session is refused and recorded as session_revoked', async () => {
      arrange({ session: null });

      await expect(build().assertActive(INPUT)).rejects.toMatchObject({
        code: ErrorCode.AUTH_DEVICE_REVOKED,
      });
      expect(revocation.revokeStandalone).toHaveBeenCalledWith(
        expect.anything(),
        { by: null, reason: 'session_revoked' },
      );
    });

    it.each([
      ['consent no longer verified', { consent_status: 'pending' }],
      ['consent revoked', { consent_status: 'revoked', revoked_at: NOW }],
      ['flagged test data', { is_test_data: true }],
      ['a custody row', { is_custodian: true, guardian_user_id: null }],
    ])(
      'the pairing guardianship with %s ends the device (guardianship_revoked)',
      async (_label, guardianship) => {
        arrange({ guardianship });

        await expect(build().assertActive(INPUT)).rejects.toMatchObject({
          code: ErrorCode.AUTH_DEVICE_REVOKED,
        });
        expect(revocation.revokeStandalone).toHaveBeenCalledWith(
          expect.anything(),
          { by: null, reason: 'guardianship_revoked' },
        );
      },
    );

    it.each([
      ['inactive', { active: false }],
      ['frozen', { dependent_profile: { frozen_at: NOW, purged_at: null } }],
      ['purged', { dependent_profile: { frozen_at: NOW, purged_at: NOW } }],
    ])('a %s dependent ends the device (dependent_frozen)', async (_l, dep) => {
      arrange({ dependent: dep });

      await expect(build().assertActive(INPUT)).rejects.toMatchObject({
        code: ErrorCode.AUTH_DEVICE_REVOKED,
      });
      expect(revocation.revokeStandalone).toHaveBeenCalledWith(
        expect.anything(),
        { by: null, reason: 'dependent_frozen' },
      );
    });

    it('an enabled supervised login ends the device (teen_login_enabled)', async () => {
      arrange({ dependent: { supervised_login: { disabled_at: null } } });

      await expect(build().assertActive(INPUT)).rejects.toMatchObject({
        code: ErrorCode.AUTH_DEVICE_REVOKED,
      });
      expect(revocation.revokeStandalone).toHaveBeenCalledWith(
        expect.anything(),
        { by: null, reason: 'teen_login_enabled' },
      );
    });

    it('the day the child reaches the age of majority the device is refused (majority)', async () => {
      arrange({ dependent: { birthday: YEARS(18.1) } });

      await expect(build().assertActive(INPUT)).rejects.toMatchObject({
        code: ErrorCode.AUTH_DEVICE_REVOKED,
      });
      expect(revocation.revokeStandalone).toHaveBeenCalledWith(
        expect.anything(),
        { by: null, reason: 'majority' },
      );
    });

    it('turning 13 does NOT revoke an existing device (only new pairings stop)', async () => {
      arrange({ dependent: { birthday: YEARS(13.2) } });

      await expect(build().assertActive(INPUT)).resolves.toMatchObject({
        active: true,
      });
      expect(revocation.revokeStandalone).not.toHaveBeenCalled();
    });

    it('a NULL birthday cannot prove a minor: fail closed', async () => {
      arrange({ dependent: { birthday: null } });

      await expect(build().assertActive(INPUT)).rejects.toMatchObject({
        code: ErrorCode.AUTH_DEVICE_REVOKED,
      });
    });

    it('a failure of the auto-revoke never fails or delays the refusal', async () => {
      arrange({ guardianship: { consent_status: 'pending' } });
      revocation.revokeStandalone.mockRejectedValue(new Error('db down'));

      await expect(build().assertActive(INPUT)).rejects.toMatchObject({
        code: ErrorCode.AUTH_DEVICE_REVOKED,
      });
      await Promise.resolve();
      expect(Logger.prototype.warn).toHaveBeenCalledWith(
        expect.stringContaining('linked_device_auto_revoke_failed'),
      );
    });

    describe('announcing what the gate revoked', () => {
      const REVOKED = [
        {
          linkedDeviceId: DEVICE,
          dependentUserId: CHILD,
          guardianshipId: GUARDIANSHIP,
          pairedByUserId: 'guardian-1',
          label: 'Tablet de Ana',
          platform: 'android',
          sessionId: SID,
        },
      ];
      // Fake timers are on: drain the promise chain of the fire-and-forget revoke.
      const settle = async () => {
        for (let i = 0; i < 10; i++) await Promise.resolve();
      };

      it('majority: announces the rows this revoke changed, with the reason', async () => {
        arrange({ dependent: { birthday: YEARS(18.1) } });
        revocation.revokeStandalone.mockResolvedValue(REVOKED);

        await expect(build().assertActive(INPUT)).rejects.toBeDefined();
        await settle();

        expect(revocation.announceAutoRevoked).toHaveBeenCalledTimes(1);
        expect(revocation.announceAutoRevoked).toHaveBeenCalledWith(
          REVOKED,
          'majority',
        );
      });

      it('expired: announces the rows this revoke changed, with the reason', async () => {
        arrange({
          device: { absolute_expires_at: new Date(NOW.getTime() - 1000) },
        });
        revocation.revokeStandalone.mockResolvedValue(REVOKED);

        await expect(build().assertActive(INPUT)).rejects.toBeDefined();
        await settle();

        expect(revocation.announceAutoRevoked).toHaveBeenCalledWith(
          REVOKED,
          'expired',
        );
      });

      it('a revoke that changed nothing (someone else won) announces nothing', async () => {
        arrange({ dependent: { birthday: YEARS(18.1) } });
        revocation.revokeStandalone.mockResolvedValue([]);

        await expect(build().assertActive(INPUT)).rejects.toBeDefined();
        await settle();

        expect(revocation.announceAutoRevoked).not.toHaveBeenCalled();
      });

      it('a failed revoke announces nothing', async () => {
        arrange({ dependent: { birthday: YEARS(18.1) } });
        revocation.revokeStandalone.mockRejectedValue(new Error('db down'));

        await expect(build().assertActive(INPUT)).rejects.toBeDefined();
        await settle();

        expect(revocation.announceAutoRevoked).not.toHaveBeenCalled();
      });

      it('an announce that throws never breaks the request', async () => {
        arrange({ dependent: { birthday: YEARS(18.1) } });
        revocation.revokeStandalone.mockResolvedValue(REVOKED);
        revocation.announceAutoRevoked.mockImplementation(() => {
          throw new Error('listener exploded');
        });

        await expect(build().assertActive(INPUT)).rejects.toMatchObject({
          code: ErrorCode.AUTH_DEVICE_REVOKED,
        });
        await settle();

        expect(Logger.prototype.warn).toHaveBeenCalledWith(
          expect.stringContaining('linked_device_auto_revoke_failed'),
        );
      });
    });

    it('caches a refusal for 10 s and does not re-revoke inside it', async () => {
      arrange({ guardianship: { consent_status: 'pending' } });
      const gate = build();

      await expect(gate.assertActive(INPUT)).rejects.toBeDefined();
      expect(cache.set).toHaveBeenCalledWith(
        expect.any(String),
        { active: false, cause: 'guardianship_invalid' },
        DEVICE_GATE_INACTIVE_TTL_MS,
      );
      await expect(gate.assertActive(INPUT)).rejects.toBeDefined();

      expect(prisma.linked_devices.findFirst).toHaveBeenCalledTimes(1);
      expect(revocation.revokeStandalone).toHaveBeenCalledTimes(1);
    });
  });

  describe('failure policy', () => {
    it('a cache outage falls back to the database', async () => {
      cache.get.mockRejectedValue(new Error('redis down'));
      cache.set.mockRejectedValue(new Error('redis down'));

      await expect(build().assertActive(INPUT)).resolves.toMatchObject({
        active: true,
      });
    });

    it('an epoch outage falls back to the database and writes nothing to the cache', async () => {
      epochs.getEpoch.mockRejectedValue(new Error('redis down'));

      await expect(build().assertActive(INPUT)).resolves.toMatchObject({
        active: true,
      });
      expect(cache.set).not.toHaveBeenCalled();
    });

    it('a database failure is 503 AUTH_REVOCATION_CHECK_UNAVAILABLE, never fail-open', async () => {
      prisma.linked_devices.findFirst.mockRejectedValue(new Error('db down'));

      await expect(build().assertActive(INPUT)).rejects.toMatchObject({
        code: ErrorCode.AUTH_REVOCATION_CHECK_UNAVAILABLE,
        status: 503,
      });
    });

    it('Redis AND the database down is still 503', async () => {
      cache.get.mockRejectedValue(new Error('redis down'));
      prisma.session.findFirst.mockRejectedValue(new Error('db down'));

      await expect(build().assertActive(INPUT)).rejects.toMatchObject({
        status: 503,
      });
    });
  });

  describe('last_seen_at', () => {
    it('100 rapid requests write it once', async () => {
      // Every request misses the cache and hits the DB path.
      cache.get.mockResolvedValue(null);
      const gate = build();

      for (let i = 0; i < 100; i += 1) {
        await gate.assertActive(INPUT);
      }

      expect(prisma.linked_devices.updateMany).toHaveBeenCalledTimes(1);
      expect(prisma.linked_devices.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            linked_device_id: DEVICE,
            revoked_at: null,
          }),
        }),
      );
    });

    it('writes again after the 5 minute window', async () => {
      cache.get.mockResolvedValue(null);
      const gate = build();
      await gate.assertActive(INPUT);

      jest.setSystemTime(NOW.getTime() + DEVICE_LAST_SEEN_INTERVAL_MS + 1000);
      await gate.assertActive(INPUT);

      expect(prisma.linked_devices.updateMany).toHaveBeenCalledTimes(2);
    });

    it('a failed write never fails the request', async () => {
      prisma.linked_devices.updateMany.mockRejectedValue(new Error('boom'));

      await expect(build().assertActive(INPUT)).resolves.toMatchObject({
        active: true,
      });
    });

    it('a refused request writes nothing', async () => {
      arrange({ device: { revoked_at: NOW } });

      await expect(build().assertActive(INPUT)).rejects.toBeDefined();
      expect(prisma.linked_devices.updateMany).not.toHaveBeenCalled();
    });
  });
});
