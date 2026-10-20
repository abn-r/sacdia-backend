import { Logger } from '@nestjs/common';
import { ErrorCode } from '../common/errors/error-codes';
import { DEVICE_PAIRING_MAX_FAILURES } from './device-pairing-failure-counter';
import {
  deriveDevicePairingTokenKey,
  hashPairingToken,
} from './device-pairing-token.util';
import {
  DevicePairingService,
  sanitizeDeviceLabel,
} from './device-pairing.service';

const SECRET = 'test-secret-min-32-chars-for-hs256-hmac';
const KEY = deriveDevicePairingTokenKey(SECRET);

const CHILD = '11111111-1111-4111-8111-111111111111';
const G1 = '22222222-2222-4222-8222-222222222222';
const GS = '33333333-3333-4333-8333-333333333333';
const NOW = new Date('2026-10-20T12:00:00.000Z');
const IP = '203.0.113.9';

const NINE_YEARS = new Date('2017-03-01T00:00:00.000Z');

const POLICY = {
  minSelfLoginAge: 13,
  ageOfMajority: 18,
  timeZone: 'America/Mexico_City',
};

const TOKEN = 'abcdefghijklmnopqrstuv'; // 22 chars, base64url alphabet

function tokenRow(over: Record<string, unknown> = {}) {
  return {
    pairing_token_id: 'tok-1',
    dependent_user_id: CHILD,
    guardianship_id: GS,
    created_by_user_id: G1,
    expires_at: new Date(NOW.getTime() + 5 * 60_000),
    consumed_at: null,
    revoked_at: null,
    ...over,
  };
}

function dependentRow(over: Record<string, unknown> = {}) {
  return {
    active: true,
    birthday: NINE_YEARS,
    country_id: 1,
    dependent_profile: { frozen_at: null, purged_at: null },
    supervised_login: null,
    account: [],
    ...over,
  };
}

describe('DevicePairingService', () => {
  let tx: Record<string, any>;
  let prisma: Record<string, any>;
  let config: { get: jest.Mock };
  let flags: { isEnabled: jest.Mock; assertEnabled: jest.Mock };
  let powers: { assertVerifiedGuardian: jest.Mock };
  let policy: { getPolicy: jest.Mock };
  let betterAuth: { createSession: jest.Mock; signDeviceJwt: jest.Mock };
  let cache: { bump: jest.Mock };
  let failures: { current: jest.Mock; increment: jest.Mock };
  let security: { onDevicePaired: jest.Mock };
  let service: DevicePairingService;

  beforeEach(() => {
    jest.useFakeTimers({ now: NOW, doNotFake: ['setImmediate', 'nextTick'] });
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    tx = {
      $executeRaw: jest.fn().mockResolvedValue(0),
      device_pairing_tokens: {
        findUnique: jest.fn().mockResolvedValue(tokenRow()),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        create: jest.fn().mockResolvedValue({}),
      },
      guardianships: {
        findFirst: jest.fn().mockResolvedValue({ guardianship_id: GS }),
      },
      users: {
        findUnique: jest.fn().mockResolvedValue(dependentRow()),
        findUniqueOrThrow: jest
          .fn()
          .mockResolvedValue({ name: 'Ana Sofía', user_image: null }),
      },
      linked_devices: {
        count: jest.fn().mockResolvedValue(0),
        create: jest.fn().mockResolvedValue({}),
      },
      audit_logs: { create: jest.fn().mockResolvedValue({}) },
    };
    prisma = {
      $transaction: jest.fn((fn: (t: unknown) => unknown) => fn(tx)),
    };
    config = { get: jest.fn().mockReturnValue(SECRET) };
    flags = {
      isEnabled: jest.fn().mockReturnValue(true),
      assertEnabled: jest.fn(),
    };
    powers = {
      assertVerifiedGuardian: jest.fn().mockResolvedValue({
        guardianship_id: GS,
        dependent_user_id: CHILD,
        guardian_user_id: G1,
      }),
    };
    policy = { getPolicy: jest.fn().mockResolvedValue({ ...POLICY }) };
    betterAuth = {
      createSession: jest.fn().mockResolvedValue({
        id: 'sid-1',
        token: 'opaque-session-token',
        expiresAt: new Date(NOW.getTime() + 30 * 86_400_000),
      }),
      signDeviceJwt: jest.fn().mockReturnValue('device.jwt.token'),
    };
    cache = { bump: jest.fn().mockResolvedValue(undefined) };
    failures = {
      current: jest.fn().mockResolvedValue(0),
      increment: jest.fn().mockResolvedValue(1),
    };
    security = { onDevicePaired: jest.fn().mockResolvedValue(undefined) };
    service = new DevicePairingService(
      prisma as never,
      config as never,
      flags as never,
      powers as never,
      policy as never,
      betterAuth as never,
      cache as never,
      failures as never,
      security as never,
    );
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  describe('issue', () => {
    it('creates a 22-char token, stores ONLY its HMAC, and returns the QR payload for 10 minutes', async () => {
      const result = await service.issue(G1, CHILD);

      expect(result.pairing_token).toMatch(/^[A-Za-z0-9_-]{22}$/);
      expect(result.qr_payload).toBe(`sacdia://pair?t=${result.pairing_token}`);
      expect(result.expires_in).toBe(600);
      expect(result.expires_at).toBe(
        new Date(NOW.getTime() + 600_000).toISOString(),
      );

      const data = tx.device_pairing_tokens.create.mock.calls[0][0].data;
      expect(data.token_hash).toBe(hashPairingToken(result.pairing_token, KEY));
      expect(data.token_hash).toMatch(/^[0-9a-f]{64}$/);
      expect(JSON.stringify(data)).not.toContain(result.pairing_token);
      expect(data).toMatchObject({
        dependent_user_id: CHILD,
        guardianship_id: GS,
        created_by_user_id: G1,
        expires_at: new Date(NOW.getTime() + 600_000),
      });
    });

    it('the token is never audited, logged or kept anywhere but the response', async () => {
      const result = await service.issue(G1, CHILD);

      expect(tx.audit_logs.create).not.toHaveBeenCalled();
      const everything = JSON.stringify([
        tx.device_pairing_tokens.updateMany.mock.calls,
        tx.device_pairing_tokens.create.mock.calls,
        (Logger.prototype.warn as jest.Mock).mock.calls,
      ]);
      expect(everything).not.toContain(result.pairing_token);
    });

    it('two tokens never collide and each one is 128 random bits', async () => {
      const tokens = new Set<string>();
      for (let i = 0; i < 50; i += 1) {
        tokens.add((await service.issue(G1, CHILD)).pairing_token);
      }
      expect(tokens.size).toBe(50);
    });

    it('a new token revokes the earlier open tokens of the same child, BEFORE creating the new one', async () => {
      await service.issue(G1, CHILD);

      expect(tx.device_pairing_tokens.updateMany).toHaveBeenCalledWith({
        where: {
          dependent_user_id: CHILD,
          consumed_at: null,
          revoked_at: null,
        },
        data: { revoked_at: NOW },
      });
      expect(
        tx.device_pairing_tokens.updateMany.mock.invocationCallOrder[0],
      ).toBeLessThan(
        tx.device_pairing_tokens.create.mock.invocationCallOrder[0],
      );
    });

    it('is feature-flagged: off is 404 FAMILY_FEATURE_DISABLED before anything is read', async () => {
      flags.assertEnabled.mockImplementation(() => {
        throw Object.assign(new Error('off'), {
          code: ErrorCode.FAMILY_FEATURE_DISABLED,
        });
      });

      await expect(service.issue(G1, CHILD)).rejects.toMatchObject({
        code: ErrorCode.FAMILY_FEATURE_DISABLED,
      });
      expect(flags.assertEnabled).toHaveBeenCalledWith('linked_device');
      expect(powers.assertVerifiedGuardian).not.toHaveBeenCalled();
    });

    it('requires a VERIFIED guardian (pending 403 / stranger 404 come from the policy, nothing is created)', async () => {
      powers.assertVerifiedGuardian.mockRejectedValue(
        Object.assign(new Error('403'), {
          code: ErrorCode.GUARDIANSHIP_CONSENT_NOT_VERIFIED,
        }),
      );

      await expect(service.issue(G1, CHILD)).rejects.toMatchObject({
        code: ErrorCode.GUARDIANSHIP_CONSENT_NOT_VERIFIED,
      });
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('re-checks the guardian INSIDE the dependent lock (a revoke in between wins)', async () => {
      powers.assertVerifiedGuardian
        .mockResolvedValueOnce({ guardianship_id: GS })
        .mockRejectedValueOnce(
          Object.assign(new Error('404'), {
            code: ErrorCode.GUARDIANSHIP_NOT_FOUND,
          }),
        );

      await expect(service.issue(G1, CHILD)).rejects.toMatchObject({
        code: ErrorCode.GUARDIANSHIP_NOT_FOUND,
      });
      expect(powers.assertVerifiedGuardian).toHaveBeenLastCalledWith(
        G1,
        CHILD,
        { db: tx },
      );
      expect(tx.device_pairing_tokens.create).not.toHaveBeenCalled();
    });

    it.each([
      ['an account holder', { account: [{ id: 'acc' }] }],
      ['an own (supervised) login', { supervised_login: { user_id: CHILD } }],
    ])('refuses a child with %s: 422 has_supervised_login', async (_l, dep) => {
      tx.users.findUnique.mockResolvedValue(dependentRow(dep));

      await expect(service.issue(G1, CHILD)).rejects.toMatchObject({
        code: ErrorCode.DEVICE_PAIRING_NOT_ELIGIBLE,
        status: 422,
        response: expect.objectContaining({
          details: { reason: 'has_supervised_login' },
        }),
      });
      expect(tx.device_pairing_tokens.create).not.toHaveBeenCalled();
    });

    it.each([
      ['13 years old', new Date('2013-03-01T00:00:00.000Z')],
      ['17 years old', new Date('2009-03-01T00:00:00.000Z')],
      ['without a birthday', null],
    ])(
      'refuses a child %s: 422 age_not_under_min_self_login',
      async (_l, birthday) => {
        tx.users.findUnique.mockResolvedValue(dependentRow({ birthday }));

        await expect(service.issue(G1, CHILD)).rejects.toMatchObject({
          code: ErrorCode.DEVICE_PAIRING_NOT_ELIGIBLE,
          response: expect.objectContaining({
            details: { reason: 'age_not_under_min_self_login' },
          }),
        });
      },
    );

    it('follows the country policy: a 14-year-old is pairable where the minimum self-login age is 16', async () => {
      tx.users.findUnique.mockResolvedValue(
        dependentRow({ birthday: new Date('2012-06-01T00:00:00.000Z') }),
      );
      policy.getPolicy.mockResolvedValue({ ...POLICY, minSelfLoginAge: 16 });

      await expect(service.issue(G1, CHILD)).resolves.toBeDefined();
    });

    it.each([
      ['inactive', { active: false }],
      ['frozen', { dependent_profile: { frozen_at: NOW, purged_at: null } }],
      ['purged', { dependent_profile: { frozen_at: NOW, purged_at: NOW } }],
      ['without a profile', { dependent_profile: null }],
    ])('a %s child is the plain 404', async (_l, dep) => {
      tx.users.findUnique.mockResolvedValue(dependentRow(dep));

      await expect(service.issue(G1, CHILD)).rejects.toMatchObject({
        code: ErrorCode.GUARDIANSHIP_NOT_FOUND,
        status: 404,
      });
    });

    it('a third active device is 409 DEVICE_LIMIT_REACHED {max_devices: 2}', async () => {
      tx.linked_devices.count.mockResolvedValue(2);

      await expect(service.issue(G1, CHILD)).rejects.toMatchObject({
        code: ErrorCode.DEVICE_LIMIT_REACHED,
        status: 409,
        response: expect.objectContaining({ namedArgs: { max_devices: 2 } }),
      });
      expect(tx.linked_devices.count).toHaveBeenCalledWith({
        where: { dependent_user_id: CHILD, revoked_at: null },
      });
    });

    it('one device left in the cap is fine', async () => {
      tx.linked_devices.count.mockResolvedValue(1);
      await expect(service.issue(G1, CHILD)).resolves.toBeDefined();
    });
  });

  describe('pair', () => {
    const dto = (over: Record<string, unknown> = {}) =>
      ({
        pairing_token: TOKEN,
        platform: 'android',
        app_version: '2.4.0',
        label: 'Tablet de Ana',
        ...over,
      }) as never;
    const context = { ipAddress: IP, userAgent: 'SACDIA/2.4' };

    it('redeems in ONE transaction: lock, re-validate, session, device, consume (compare-and-set), audit', async () => {
      const result = await service.pair(dto(), context);

      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      expect(tx.$executeRaw).toHaveBeenCalled(); // lockDependent

      // 30-day session created INSIDE the transaction.
      expect(betterAuth.createSession).toHaveBeenCalledWith(CHILD, context, {
        durationMs: 30 * 86_400_000,
        tx,
      });
      const created = tx.linked_devices.create.mock.calls[0][0].data;
      expect(created).toMatchObject({
        dependent_user_id: CHILD,
        guardianship_id: GS,
        paired_by_user_id: G1,
        session_id: 'sid-1',
        label: 'Tablet de Ana',
        platform: 'android',
        app_version: '2.4.0',
        paired_at: NOW,
        absolute_expires_at: new Date(NOW.getTime() + 180 * 86_400_000),
      });
      // Token consumed with the new device id, guarded by a CAS.
      expect(tx.device_pairing_tokens.updateMany).toHaveBeenCalledWith({
        where: {
          pairing_token_id: 'tok-1',
          consumed_at: null,
          revoked_at: null,
          expires_at: { gt: NOW },
        },
        data: {
          consumed_at: NOW,
          consumed_device_id: created.linked_device_id,
        },
      });
      // The device is created BEFORE the token points at it (FK + consumed pair CHECK).
      expect(tx.linked_devices.create.mock.invocationCallOrder[0]).toBeLessThan(
        tx.device_pairing_tokens.updateMany.mock.invocationCallOrder[0],
      );

      expect(tx.audit_logs.create.mock.calls[0][0].data).toMatchObject({
        entity_type: 'linked_device',
        entity_id: created.linked_device_id,
        action: 'linked_device.paired',
        actor_user_id: CHILD,
        actor_kind: 'linked_device',
        target_user_id: CHILD,
        request_context: {
          linked_device_id: created.linked_device_id,
          paired_by: G1,
        },
      });

      expect(result).toEqual({
        accessToken: 'device.jwt.token',
        refreshToken: 'opaque-session-token',
        expiresAt: Math.floor((NOW.getTime() + 30 * 86_400_000) / 1000),
        tokenType: 'bearer',
        device: {
          linked_device_id: created.linked_device_id,
          label: 'Tablet de Ana',
        },
        user: { id: CHILD, name: 'Ana', avatar: null },
      });
      expect(betterAuth.signDeviceJwt).toHaveBeenCalledWith({
        dependentUserId: CHILD,
        sessionId: 'sid-1',
        linkedDeviceId: created.linked_device_id,
      });
    });

    it('looks the token up by its HMAC, never by the plain value', async () => {
      await service.pair(dto(), context);

      expect(tx.device_pairing_tokens.findUnique).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { token_hash: hashPairingToken(TOKEN, KEY) },
        }),
      );
    });

    it('after the commit: bumps the child epoch and tells the guardians (label + platform, never the token)', async () => {
      await service.pair(dto(), context);

      expect(cache.bump).toHaveBeenCalledWith(CHILD);
      expect(security.onDevicePaired).toHaveBeenCalledWith({
        dependentUserId: CHILD,
        label: 'Tablet de Ana',
        platform: 'android',
      });
      expect(JSON.stringify(security.onDevicePaired.mock.calls)).not.toContain(
        TOKEN,
      );
    });

    it('the response carries no pairing token, email, last name, guardian or other child', async () => {
      const result = await service.pair(dto(), context);

      const body = JSON.stringify(result);
      expect(body).not.toContain(TOKEN);
      expect(body).not.toMatch(/email|guardian|paternal|maternal/i);
      expect(Object.keys(result).sort()).toEqual(
        [
          'accessToken',
          'device',
          'expiresAt',
          'refreshToken',
          'tokenType',
          'user',
        ].sort(),
      );
      expect(Object.keys(result.user).sort()).toEqual(['avatar', 'id', 'name']);
    });

    it('the audit row never contains the token', async () => {
      await service.pair(dto(), context);

      expect(JSON.stringify(tx.audit_logs.create.mock.calls)).not.toContain(
        TOKEN,
      );
    });

    describe('every failure about the token or the family is the SAME 400', () => {
      const expectUniform = async (promise: Promise<unknown>) => {
        const error = (await promise.catch((e: unknown) => e)) as {
          code: string;
          status: number;
          getResponse: () => unknown;
        };
        expect(error.code).toBe(ErrorCode.DEVICE_PAIRING_TOKEN_INVALID);
        expect(error.status).toBe(400);
        return JSON.stringify(error.getResponse());
      };

      it('unknown, expired by 1 s, consumed, revoked, guardianship gone, account created, flag off, malformed: byte-identical bodies', async () => {
        const bodies: string[] = [];

        tx.device_pairing_tokens.findUnique.mockResolvedValue(null);
        bodies.push(await expectUniform(service.pair(dto(), context)));

        tx.device_pairing_tokens.findUnique.mockResolvedValue(
          tokenRow({ expires_at: new Date(NOW.getTime() - 1000) }),
        );
        bodies.push(await expectUniform(service.pair(dto(), context)));

        tx.device_pairing_tokens.findUnique.mockResolvedValue(
          tokenRow({ consumed_at: NOW }),
        );
        bodies.push(await expectUniform(service.pair(dto(), context)));

        tx.device_pairing_tokens.findUnique.mockResolvedValue(
          tokenRow({ revoked_at: NOW }),
        );
        bodies.push(await expectUniform(service.pair(dto(), context)));

        tx.device_pairing_tokens.findUnique.mockResolvedValue(tokenRow());
        tx.guardianships.findFirst.mockResolvedValue(null);
        bodies.push(await expectUniform(service.pair(dto(), context)));

        tx.guardianships.findFirst.mockResolvedValue({ guardianship_id: GS });
        tx.users.findUnique.mockResolvedValue(
          dependentRow({ supervised_login: { user_id: CHILD } }),
        );
        bodies.push(await expectUniform(service.pair(dto(), context)));

        tx.users.findUnique.mockResolvedValue(dependentRow());
        flags.isEnabled.mockReturnValue(false);
        bodies.push(await expectUniform(service.pair(dto(), context)));

        flags.isEnabled.mockReturnValue(true);
        bodies.push(
          await expectUniform(
            service.pair(dto({ pairing_token: 'short' }), context),
          ),
        );

        expect(new Set(bodies).size).toBe(1);
      });

      it('a token that expired exactly now is dead (expires_at <= now)', async () => {
        tx.device_pairing_tokens.findUnique.mockResolvedValue(
          tokenRow({ expires_at: NOW }),
        );
        await expectUniform(service.pair(dto(), context));
      });

      it('10 minutes + 1 second after creation the token is invalid', async () => {
        tx.device_pairing_tokens.findUnique.mockResolvedValue(
          tokenRow({ expires_at: new Date(NOW.getTime() + 600_000) }),
        );
        await service.pair(dto(), context); // still valid now
        tx.device_pairing_tokens.findUnique.mockResolvedValue(
          tokenRow({ expires_at: new Date(NOW.getTime() + 600_000) }),
        );
        jest.setSystemTime(NOW.getTime() + 601_000);
        await expectUniform(service.pair(dto(), context));
      });

      it('the pairing guardianship must still belong to the issuing guardian and be verified, non-custodian, non-test', async () => {
        await service.pair(dto(), context);

        expect(tx.guardianships.findFirst).toHaveBeenCalledWith({
          where: expect.objectContaining({
            guardianship_id: GS,
            dependent_user_id: CHILD,
            guardian_user_id: G1,
            consent_status: 'verified',
            is_custodian: false,
            is_test_data: false,
          }),
          select: { guardianship_id: true },
        });
      });

      it('two phones racing for one token: the loser fails the compare-and-set, rolls back and gets the uniform 400', async () => {
        tx.device_pairing_tokens.updateMany.mockResolvedValue({ count: 0 });

        await expectUniform(service.pair(dto(), context));

        expect(cache.bump).not.toHaveBeenCalled();
        expect(security.onDevicePaired).not.toHaveBeenCalled();
      });

      it('a failure leaves no side effect after the transaction (no bump, no notice, no JWT)', async () => {
        tx.device_pairing_tokens.findUnique.mockResolvedValue(null);

        await expectUniform(service.pair(dto(), context));

        expect(betterAuth.signDeviceJwt).not.toHaveBeenCalled();
        expect(cache.bump).not.toHaveBeenCalled();
      });
    });

    it('the device cap holds under the lock: a valid token on a child with 2 devices is 409 and the token is NOT consumed', async () => {
      tx.linked_devices.count.mockResolvedValue(2);

      await expect(service.pair(dto(), context)).rejects.toMatchObject({
        code: ErrorCode.DEVICE_LIMIT_REACHED,
        status: 409,
      });
      expect(tx.device_pairing_tokens.updateMany).not.toHaveBeenCalled();
      expect(tx.linked_devices.create).not.toHaveBeenCalled();
      // A 409 is not a token failure: it does not count against the IP.
      expect(failures.increment).not.toHaveBeenCalled();
    });

    it('turning 13 between issue and redeem makes the token invalid', async () => {
      tx.users.findUnique.mockResolvedValue(
        dependentRow({ birthday: new Date('2013-03-01T00:00:00.000Z') }),
      );

      await expect(service.pair(dto(), context)).rejects.toMatchObject({
        code: ErrorCode.DEVICE_PAIRING_TOKEN_INVALID,
      });
    });

    describe('abuse limits', () => {
      it('counts every token failure against the IP', async () => {
        tx.device_pairing_tokens.findUnique.mockResolvedValue(null);

        await expect(service.pair(dto(), context)).rejects.toBeDefined();

        expect(failures.increment).toHaveBeenCalledWith(IP);
      });

      it('a success does not count', async () => {
        await service.pair(dto(), context);
        expect(failures.increment).not.toHaveBeenCalled();
      });

      it('30 failures a day from one IP: 429 even for a valid token, before any database read', async () => {
        failures.current.mockResolvedValue(DEVICE_PAIRING_MAX_FAILURES);

        await expect(service.pair(dto(), context)).rejects.toMatchObject({
          code: ErrorCode.AUTH_LOGIN_LOCKED,
          status: 429,
        });
        expect(prisma.$transaction).not.toHaveBeenCalled();
      });

      it('29 failures is still allowed', async () => {
        failures.current.mockResolvedValue(DEVICE_PAIRING_MAX_FAILURES - 1);
        await expect(service.pair(dto(), context)).resolves.toBeDefined();
      });

      it('a counter outage never opens anything: the pairing still validates the token', async () => {
        failures.current.mockRejectedValue(new Error('redis down'));
        failures.increment.mockRejectedValue(new Error('redis down'));
        tx.device_pairing_tokens.findUnique.mockResolvedValue(null);

        await expect(service.pair(dto(), context)).rejects.toMatchObject({
          code: ErrorCode.DEVICE_PAIRING_TOKEN_INVALID,
        });
      });

      it('an unknown IP is bucketed together instead of skipping the limit', async () => {
        tx.device_pairing_tokens.findUnique.mockResolvedValue(null);

        await expect(service.pair(dto(), {})).rejects.toBeDefined();

        expect(failures.increment).toHaveBeenCalledWith('unknown');
      });
    });

    describe('label and app version are sanitized', () => {
      it('strips markup and control characters', async () => {
        await service.pair(
          dto({ label: '<script>alert(1)</script>\u0000\u0007Ana' }),
          context,
        );

        const label = tx.linked_devices.create.mock.calls[0][0].data.label;
        // eslint-disable-next-line no-control-regex
        expect(label).not.toMatch(/[<>\u0000-\u001F]/);
        expect(label).toContain('Ana');
      });

      it('a 500 character label is cut to 40 and does not fail', async () => {
        const result = await service.pair(
          dto({ label: 'x'.repeat(500) }),
          context,
        );

        expect(result.device.label).toHaveLength(40);
      });

      it('no label (or only characters that get stripped) falls back to a default', async () => {
        await service.pair(dto({ label: undefined }), context);
        await service.pair(dto({ label: '<<>>' }), context);

        const labels = tx.linked_devices.create.mock.calls.map(
          (c: any[]) => c[0].data.label,
        );
        expect(labels).toEqual(['Dispositivo', 'Dispositivo']);
      });

      it('keeps at most 32 characters of the app version, null when empty', async () => {
        await service.pair(dto({ app_version: '9'.repeat(60) }), context);
        await service.pair(dto({ app_version: undefined }), context);

        const versions = tx.linked_devices.create.mock.calls.map(
          (c: any[]) => c[0].data.app_version,
        );
        expect(versions[0]).toHaveLength(32);
        expect(versions[1]).toBeNull();
      });

      it('sanitizeDeviceLabel is stable for plain text', () => {
        expect(sanitizeDeviceLabel('  Tablet   de Ana ')).toBe('Tablet de Ana');
      });
    });
  });
});
