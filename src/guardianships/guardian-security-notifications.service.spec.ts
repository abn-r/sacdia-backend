import { Logger } from '@nestjs/common';
import {
  GuardianSecurityNotificationsService,
  NEW_SESSION_DEDUPE_MS,
  noticeText,
  SECURITY_SOURCE,
  type SecurityEvent,
} from './guardian-security-notifications.service';

const TEEN = 'dddddddd-0000-4000-8000-000000000001';
const G1 = 'gggggggg-0000-4000-8000-000000000001';
const G2 = 'gggggggg-0000-4000-8000-000000000002';
const NOW = new Date('2026-10-20T15:00:00.000Z');

const yearsAgo = (years: number) => {
  const d = new Date(NOW);
  d.setUTCFullYear(d.getUTCFullYear() - years);
  d.setUTCDate(d.getUTCDate() - 3);
  return d;
};

function setup(
  options: {
    name?: string | null;
    birthday?: Date | null;
    guardians?: string[];
  } = {},
) {
  const store = new Map<string, unknown>();
  const cache = {
    get: jest.fn(async (key: string) => store.get(key)),
    set: jest.fn(async (key: string, value: unknown) => {
      store.set(key, value);
    }),
  };
  const prisma: any = {
    users: {
      findUnique: jest.fn().mockResolvedValue({
        name: options.name === undefined ? 'Ana María' : options.name,
        birthday:
          options.birthday === undefined ? yearsAgo(15) : options.birthday,
        country_id: null,
        guardianships_as_dependent: (options.guardians ?? [G1, G2]).map(
          (id) => ({
            guardian_user_id: id,
          }),
        ),
      }),
      findFirst: jest.fn().mockResolvedValue({ user_id: TEEN }),
    },
    supervised_logins: {
      findFirst: jest.fn().mockResolvedValue({ user_id: TEEN }),
    },
    $transaction: jest.fn(async (cb: (tx: any) => unknown) => cb(prisma._tx)),
    _tx: {
      notification_logs: {
        create: jest.fn().mockResolvedValue({ log_id: 77 }),
      },
      notification_deliveries: { create: jest.fn().mockResolvedValue({}) },
    },
  };
  const notifications = {
    sendToUser: jest.fn().mockResolvedValue({ success: true }),
  };
  const agePolicy = {
    getPolicy: jest.fn().mockResolvedValue({
      minSelfLoginAge: 13,
      ageOfMajority: 18,
      timeZone: 'America/Mexico_City',
    }),
  };
  const service = new GuardianSecurityNotificationsService(
    prisma,
    notifications as any,
    agePolicy as any,
    cache as any,
  );
  return { service, prisma, notifications, agePolicy, cache, store };
}

beforeAll(() => {
  jest.useFakeTimers({ doNotFake: ['setImmediate', 'nextTick'] });
  jest.setSystemTime(NOW);
});
afterAll(() => jest.useRealTimers());
beforeEach(() => {
  jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
});
afterEach(() => jest.restoreAllMocks());

describe('recipients', () => {
  it('asks only for ACTIVE, non-custodian, non-test USER guardians whose row is VERIFIED, at most 4', async () => {
    const { service, prisma } = setup();
    await service.onTeenSessionStarted({ userId: TEEN });

    const select = prisma.users.findUnique.mock.calls[0][0].select;
    expect(select.guardianships_as_dependent).toMatchObject({
      take: 4,
      where: {
        consent_status: 'verified',
        is_custodian: false,
        is_test_data: false,
        guardian_user_id: { not: null },
      },
    });
  });

  it('notifies every verified guardian once, with push+inbox through sendToUser and the mandatory source', async () => {
    const { service, notifications } = setup();
    await service.onTeenPasswordChanged({ userId: TEEN });

    expect(notifications.sendToUser).toHaveBeenCalledTimes(2);
    expect(notifications.sendToUser).toHaveBeenCalledWith(
      {
        userId: G1,
        title: 'Ana · cambió su contraseña',
        body: 'Ana cambió la contraseña de su cuenta.',
        data: {
          type: 'dependent_security',
          event: 'teen_password_changed',
          dependent_user_id: TEEN,
        },
      },
      'system',
      SECURITY_SOURCE,
    );
    expect(
      notifications.sendToUser.mock.calls.map((c: any[]) => c[0].userId).sort(),
    ).toEqual([G1, G2]);
  });

  it('never notifies the actor of their own action', async () => {
    const { service, notifications } = setup();
    await service.onLoginDisabled({ dependentUserId: TEEN, actorUserId: G1 });
    expect(
      notifications.sendToUser.mock.calls.map((c: any[]) => c[0].userId),
    ).toEqual([G2]);
  });

  it('is a no-op when the teen has no verified guardian (pending links and custody are not recipients)', async () => {
    const { service, notifications } = setup({ guardians: [] });
    await service.onTeenSessionStarted({ userId: TEEN });
    expect(notifications.sendToUser).not.toHaveBeenCalled();
  });

  it('is a no-op when the actor is the only guardian', async () => {
    const { service, notifications } = setup({ guardians: [G1] });
    await service.onLoginEnabled({ dependentUserId: TEEN, actorUserId: G1 });
    expect(notifications.sendToUser).not.toHaveBeenCalled();
  });

  it('stops at the age of majority (the former teen is an adult)', async () => {
    const { service, notifications } = setup({ birthday: yearsAgo(19) });
    await service.onTeenPasswordChanged({ userId: TEEN });
    expect(notifications.sendToUser).not.toHaveBeenCalled();
  });

  it('follows the country policy (majority 16)', async () => {
    const { service, notifications, agePolicy } = setup({
      birthday: yearsAgo(16),
    });
    agePolicy.getPolicy.mockResolvedValue({
      minSelfLoginAge: 13,
      ageOfMajority: 16,
      timeZone: 'America/Mexico_City',
    });
    await service.onTeenPasswordChanged({ userId: TEEN });
    expect(notifications.sendToUser).not.toHaveBeenCalled();
  });

  it('is a no-op for an unknown user or one without a birthday', async () => {
    const unknown = setup();
    unknown.prisma.users.findUnique.mockResolvedValue(null);
    await unknown.service.onTeenSessionStarted({ userId: TEEN });
    expect(unknown.notifications.sendToUser).not.toHaveBeenCalled();

    const noBirthday = setup({ birthday: null });
    await noBirthday.service.onTeenSessionStarted({ userId: TEEN });
    expect(noBirthday.notifications.sendToUser).not.toHaveBeenCalled();
  });
});

describe('new session dedupe', () => {
  it('one notice per 15 minutes; the window re-opens afterwards', async () => {
    const { service, notifications } = setup();

    await service.onTeenSessionStarted({ userId: TEEN });
    await service.onTeenSessionStarted({ userId: TEEN });
    expect(notifications.sendToUser).toHaveBeenCalledTimes(2); // 2 guardians, once

    // The fake cache has no real TTL: simulate expiry.
    (service as any).cache.get.mockResolvedValue(undefined);
    await service.onTeenSessionStarted({ userId: TEEN });
    expect(notifications.sendToUser).toHaveBeenCalledTimes(4);
  });

  it('uses a 15 minute TTL keyed on the dependent', async () => {
    const { service, cache } = setup();
    await service.onTeenSessionStarted({ userId: TEEN });
    expect(cache.set).toHaveBeenCalledWith(
      `family-security:new-session:${TEEN}`,
      1,
      NEW_SESSION_DEDUPE_MS,
    );
    expect(NEW_SESSION_DEDUPE_MS).toBe(900_000);
  });

  it('a login with NO recipient does not consume the window (the first notice after verification still goes out)', async () => {
    // Regression (QA BUG-2): the window used to be claimed before resolving the
    // recipients, so a login while the guardian was still pending silenced the
    // first notice once the guardian got verified.
    const { service, notifications, prisma, cache } = setup({ guardians: [] });

    await service.onTeenSessionStarted({ userId: TEEN });
    expect(notifications.sendToUser).not.toHaveBeenCalled();
    expect(cache.set).not.toHaveBeenCalled();

    // The guardian is verified now; the teen logs in again inside 15 minutes.
    prisma.users.findUnique.mockResolvedValue({
      name: 'Ana María',
      birthday: yearsAgo(15),
      country_id: null,
      guardianships_as_dependent: [{ guardian_user_id: G1 }],
    });
    await service.onTeenSessionStarted({ userId: TEEN });
    expect(notifications.sendToUser).toHaveBeenCalledTimes(1);
    expect(notifications.sendToUser.mock.calls[0][0].userId).toBe(G1);
  });

  it('other events are never deduplicated', async () => {
    const { service, notifications } = setup();
    await service.onTeenPasswordChanged({ userId: TEEN });
    await service.onTeenPasswordChanged({ userId: TEEN });
    expect(notifications.sendToUser).toHaveBeenCalledTimes(4);
  });

  it('a cache outage lets the notice through', async () => {
    const { service, notifications, cache } = setup();
    cache.get.mockRejectedValue(new Error('redis down'));
    cache.set.mockRejectedValue(new Error('redis down'));
    await service.onTeenSessionStarted({ userId: TEEN });
    expect(notifications.sendToUser).toHaveBeenCalledTimes(2);
  });
});

describe('best effort', () => {
  it('never throws when the notifier fails; the caller (login, reset, update) is unaffected', async () => {
    const { service, notifications } = setup();
    notifications.sendToUser.mockRejectedValue(new Error('fcm down'));
    await expect(
      service.onTeenPasswordChanged({ userId: TEEN }),
    ).resolves.toBeUndefined();
  });

  it('never throws when the lookup fails', async () => {
    const { service, prisma } = setup();
    prisma.users.findUnique.mockRejectedValue(new Error('db down'));
    await expect(
      service.onTeenSessionStarted({ userId: TEEN }),
    ).resolves.toBeUndefined();
  });

  it('one failing recipient does not stop the others', async () => {
    const { service, notifications } = setup();
    notifications.sendToUser
      .mockRejectedValueOnce(new Error('first failed'))
      .mockResolvedValue({ success: true });
    await service.onTeenPasswordChanged({ userId: TEEN });
    expect(notifications.sendToUser).toHaveBeenCalledTimes(2);
  });
});

describe('events', () => {
  it('password reset by a guardian: the OTHER guardians get a push+inbox notice and the teen an inbox-only one', async () => {
    const { service, notifications, prisma } = setup();
    await service.onPasswordReset({ dependentUserId: TEEN, actorUserId: G1 });

    expect(
      notifications.sendToUser.mock.calls.map((c: any[]) => c[0].userId),
    ).toEqual([G2]);
    // The teen: inbox row, NO push (sendToUser is the push path).
    expect(prisma._tx.notification_logs.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        target_id: TEEN,
        source: SECURITY_SOURCE,
        type: 'USER',
      }),
    });
    expect(prisma._tx.notification_deliveries.create).toHaveBeenCalledWith({
      data: { log_id: 77, user_id: TEEN },
    });
    expect(
      notifications.sendToUser.mock.calls.some(
        (c: any[]) => c[0].userId === TEEN,
      ),
    ).toBe(false);
  });

  it('a teen email reset (no actor): every verified guardian is told and the teen gets no extra inbox row', async () => {
    const { service, notifications, prisma } = setup();
    await service.onPasswordReset({ dependentUserId: TEEN });
    expect(notifications.sendToUser).toHaveBeenCalledTimes(2);
    expect(prisma._tx.notification_logs.create).not.toHaveBeenCalled();
  });

  it('lock episode of a handle: found through supervised_logins, guardians told, the handle is NOT in the text', async () => {
    const { service, notifications, prisma } = setup();
    await service.onLoginLocked({
      identifier: 'ana-7kq4m9tx',
      retryAfterSeconds: 900,
    });

    expect(prisma.supervised_logins.findFirst).toHaveBeenCalledWith({
      where: { login_handle: 'ana-7kq4m9tx' },
      select: { user_id: true },
    });
    expect(notifications.sendToUser).toHaveBeenCalledTimes(2);
    const serialized = JSON.stringify(notifications.sendToUser.mock.calls);
    expect(serialized).not.toContain('ana-7kq4m9tx');
  });

  it('lock episode of an email: case-insensitive lookup, the email is NOT in the text', async () => {
    const { service, notifications, prisma } = setup();
    await service.onLoginLocked({
      identifier: 'ana@example.com',
      retryAfterSeconds: 900,
    });
    expect(prisma.users.findFirst.mock.calls[0][0].where).toEqual({
      email: { equals: 'ana@example.com', mode: 'insensitive' },
    });
    expect(JSON.stringify(notifications.sendToUser.mock.calls)).not.toContain(
      'ana@example.com',
    );
  });

  it('lock episode of an UNKNOWN identifier does nothing and reveals nothing', async () => {
    const { service, notifications, prisma } = setup();
    prisma.supervised_logins.findFirst.mockResolvedValue(null);
    await expect(
      service.onLoginLocked({
        identifier: 'nobody-xx99zz',
        retryAfterSeconds: 900,
      }),
    ).resolves.toBeUndefined();
    expect(notifications.sendToUser).not.toHaveBeenCalled();
  });

  it('guardian linked: told to the TEEN with the guardian_linked source', async () => {
    const { service, notifications } = setup();
    await service.onGuardianLinked({ teenUserId: TEEN, guardianUserId: G1 });
    expect(notifications.sendToUser).toHaveBeenCalledTimes(1);
    const [dto, sentBy, source] = notifications.sendToUser.mock.calls[0];
    expect(dto.userId).toBe(TEEN);
    expect(sentBy).toBe('system');
    expect(source).toBe('family:guardian_linked');
    expect(JSON.stringify(dto)).not.toContain(G1);
  });

  it('device hooks for 3b use the same recipients and mandatory source', async () => {
    const { service, notifications } = setup();
    await service.onDevicePaired({
      dependentUserId: TEEN,
      label: 'Tablet de Ana',
      platform: 'android',
    });
    expect(notifications.sendToUser).toHaveBeenCalledTimes(2);
    expect(notifications.sendToUser.mock.calls[0][0].body).toContain(
      'Tablet de Ana',
    );
    await service.onDeviceRevoked({
      dependentUserId: TEEN,
      label: 'Tablet de Ana',
      excludeUserId: G1,
    });
    expect(notifications.sendToUser).toHaveBeenCalledTimes(3);
  });
});

describe('noticeText', () => {
  const EVENTS: SecurityEvent[] = [
    'teen_new_session',
    'teen_password_changed',
    'teen_password_reset',
    'teen_login_locked',
    'teen_login_disabled',
    'teen_login_enabled',
    'teen_login_reactivated',
    'device_paired',
    'device_revoked',
    'teen_guardian_linked',
  ];

  it.each(EVENTS)(
    '%s: the title starts with the first name and the body has no secrets',
    (event) => {
      const text = noticeText(event, 'Ana', 'Tablet');
      expect(text.title.startsWith('Ana ·')).toBe(true);
      for (const forbidden of [
        'contraseña:',
        'password',
        'token',
        'handle',
        'usuario:',
        'IP',
        'http',
      ]) {
        expect(text.body).not.toContain(forbidden);
        expect(text.title).not.toContain(forbidden);
      }
    },
  );
});
