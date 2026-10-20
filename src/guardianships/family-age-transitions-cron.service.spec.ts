import { Logger } from '@nestjs/common';
import { ErrorCode } from '../common/errors/error-codes';
import { LinkedDeviceGate } from '../auth/device/linked-device.gate';
import {
  AGE_NUDGE_SOURCE,
  FAMILY_AGE_TRANSITIONS_JOB,
  FamilyAgeTransitionsCronService,
} from './family-age-transitions-cron.service';

// 14:00 UTC = 08:00 in Mexico City (the cron schedule). Mexico has no DST.
const NOW = new Date('2026-10-20T14:00:00.000Z');
const ANA = 'aaaaaaaa-0000-4000-8000-000000000001';
const LUIS = 'aaaaaaaa-0000-4000-8000-000000000002';
const G1 = 'bbbbbbbb-0000-4000-8000-000000000001';
const G2 = 'bbbbbbbb-0000-4000-8000-000000000002';
const DEV_A = 'cccccccc-0000-4000-8000-000000000001';
const DEV_B = 'cccccccc-0000-4000-8000-000000000002';

const MEXICO = {
  minSelfLoginAge: 13,
  ageOfMajority: 18,
  timeZone: 'America/Mexico_City',
};
const AUCKLAND = {
  minSelfLoginAge: 13,
  ageOfMajority: 18,
  timeZone: 'Pacific/Auckland',
};
const MAJORITY_16 = {
  minSelfLoginAge: 13,
  ageOfMajority: 16,
  timeZone: 'America/Mexico_City',
};

const day = (iso: string) => new Date(`${iso}T00:00:00.000Z`);
const DAY_MS = 24 * 60 * 60 * 1000;

function candidate(
  userId: string,
  birthday: string | null,
  extra: Record<string, unknown> = {},
) {
  return {
    user_id: userId,
    birthday: birthday ? day(birthday) : null,
    country_id: 1,
    supervised_login: null,
    ...extra,
  };
}

function device(
  id: string,
  dependent: string,
  birthday: string | null,
  extra: Record<string, unknown> = {},
) {
  return {
    linked_device_id: id,
    dependent_user_id: dependent,
    absolute_expires_at: new Date(NOW.getTime() + 100 * DAY_MS),
    dependent: { birthday: birthday ? day(birthday) : null, country_id: 1 },
    ...extra,
  };
}

function setup() {
  const tx: any = {
    users: { findUnique: jest.fn() },
  };
  const prisma: any = {
    users: { findMany: jest.fn().mockResolvedValue([]) },
    dependent_profiles: {
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    linked_devices: { findMany: jest.fn().mockResolvedValue([]) },
    $transaction: jest.fn(async (fn: (t: any) => unknown) => fn(tx)),
  };
  const lock = {
    tryAcquire: jest.fn().mockResolvedValue(true),
    release: jest.fn().mockResolvedValue(undefined),
  };
  const cronLogger = {
    track: jest.fn(async (_n: string, fn: () => Promise<unknown>) => fn()),
    trackSkipped: jest.fn().mockResolvedValue(undefined),
  };
  const notifications = { sendToUser: jest.fn().mockResolvedValue({}) };
  const security = {
    recipientsOf: jest
      .fn()
      .mockResolvedValue({ firstName: 'Ana', guardianIds: [G1] }),
  };
  const flags = { isEnabled: jest.fn().mockReturnValue(true) };
  const agePolicy = {
    getPolicy: jest.fn().mockImplementation((countryId: number | null) => {
      if (countryId === 2) return Promise.resolve(AUCKLAND);
      if (countryId === 3) return Promise.resolve(MAJORITY_16);
      return Promise.resolve(MEXICO);
    }),
  };
  const linkedDevices = {
    revokeBySystem: jest.fn().mockResolvedValue(1),
  };
  const service = new FamilyAgeTransitionsCronService(
    prisma,
    lock as any,
    cronLogger as any,
    agePolicy as any,
    notifications as any,
    security as any,
    flags as any,
    linkedDevices as any,
  );
  return {
    service,
    prisma,
    tx,
    lock,
    cronLogger,
    notifications,
    security,
    flags,
    agePolicy,
    linkedDevices,
  };
}

/** The first users.findMany returns `rows`, the next ones are empty. */
function withCandidates(ctx: ReturnType<typeof setup>, rows: unknown[]) {
  ctx.prisma.users.findMany.mockResolvedValueOnce(rows).mockResolvedValue([]);
}

function withDevices(ctx: ReturnType<typeof setup>, rows: unknown[]) {
  ctx.prisma.linked_devices.findMany
    .mockResolvedValueOnce(rows)
    .mockResolvedValue([]);
}

beforeEach(() => {
  jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('FamilyAgeTransitionsCronService scheduling and locking', () => {
  it('runs daily at 14:00 UTC under the documented job name', () => {
    const metadata = (key: string) =>
      Reflect.getMetadata(
        key,
        FamilyAgeTransitionsCronService.prototype.handleDaily,
      );
    expect(FAMILY_AGE_TRANSITIONS_JOB).toBe('family-age-transitions');
    expect(metadata('SCHEDULE_CRON_OPTIONS')).toMatchObject({
      cronTime: '0 14 * * *',
      name: 'family-age-transitions',
      timeZone: 'UTC',
    });
  });

  it('takes the 23h lock, tracks the run and always releases', async () => {
    const { service, lock, cronLogger } = setup();
    await service.handleDaily();
    expect(lock.tryAcquire).toHaveBeenCalledWith(
      'cron:family-age-transitions',
      23 * 60 * 60 * 1000,
    );
    expect(cronLogger.track).toHaveBeenCalledWith(
      'family-age-transitions',
      expect.any(Function),
    );
    expect(lock.release).toHaveBeenCalledWith('cron:family-age-transitions');
  });

  it('a second instance that does not get the lock records a skip and touches nothing', async () => {
    const ctx = setup();
    ctx.lock.tryAcquire.mockResolvedValue(false);
    await ctx.service.handleDaily();
    expect(ctx.cronLogger.trackSkipped).toHaveBeenCalledWith(
      'family-age-transitions',
      'lock_not_acquired',
    );
    expect(ctx.cronLogger.track).not.toHaveBeenCalled();
    expect(ctx.prisma.users.findMany).not.toHaveBeenCalled();
    expect(ctx.prisma.linked_devices.findMany).not.toHaveBeenCalled();
    expect(ctx.lock.release).not.toHaveBeenCalled();
  });

  it('fails the tracked run when a dependent could not be processed (retried next run), still releasing the lock', async () => {
    const ctx = setup();
    withCandidates(ctx, [candidate(ANA, '2013-10-20')]);
    ctx.notifications.sendToUser.mockRejectedValue(new Error('fcm down'));
    ctx.cronLogger.track.mockImplementation(
      async (_n: string, fn: () => Promise<unknown>) => {
        await expect(fn()).rejects.toThrow(/could not be processed/);
      },
    );

    await ctx.service.handleDaily();

    expect(ctx.lock.release).toHaveBeenCalledWith(
      'cron:family-age-transitions',
    );
  });
});

describe('FamilyAgeTransitionsCronService birthday-13 nudge (B14)', () => {
  it('a dependent who turns 13 today gets ONE nudge to its verified guardian, with the app routing data', async () => {
    const ctx = setup();
    withCandidates(ctx, [candidate(ANA, '2013-10-20')]);

    const summary = await ctx.service.run(NOW);

    expect(summary.nudged).toBe(1);
    expect(ctx.security.recipientsOf).toHaveBeenCalledWith(ANA);
    expect(ctx.notifications.sendToUser).toHaveBeenCalledTimes(1);
    const [dto, sentBy, source] = ctx.notifications.sendToUser.mock.calls[0];
    expect(dto.userId).toBe(G1);
    expect(dto.title).toContain('Ana');
    expect(dto.data).toEqual({
      type: 'dependent_age_milestone',
      event: 'age_milestone',
      dependent_user_id: ANA,
    });
    expect(sentBy).toBe('system');
    expect(source).toBe(AGE_NUDGE_SOURCE);
    expect(AGE_NUDGE_SOURCE).toBe('family:age_nudge');
    // Never leaks the birthday or the age into the notice.
    expect(JSON.stringify(dto)).not.toContain('2013');
  });

  it('claims teen_login_nudged_at with a compare-and-set BEFORE sending', async () => {
    const ctx = setup();
    withCandidates(ctx, [candidate(ANA, '2013-10-20')]);
    const order: string[] = [];
    ctx.prisma.dependent_profiles.updateMany.mockImplementation(() => {
      order.push('claim');
      return Promise.resolve({ count: 1 });
    });
    ctx.notifications.sendToUser.mockImplementation(() => {
      order.push('send');
      return Promise.resolve({});
    });

    await ctx.service.run(NOW);

    expect(order).toEqual(['claim', 'send']);
    expect(ctx.prisma.dependent_profiles.updateMany).toHaveBeenCalledWith({
      where: {
        user_id: ANA,
        teen_login_nudged_at: null,
        frozen_at: null,
        purged_at: null,
      },
      data: { teen_login_nudged_at: NOW },
    });
  });

  it('asks only for the right rows: no account, no enabled login, not frozen, never nudged, birthday known', async () => {
    const ctx = setup();

    await ctx.service.run(NOW);

    const query = ctx.prisma.users.findMany.mock.calls[0][0];
    expect(query.take).toBe(100);
    expect(query.orderBy).toEqual({ user_id: 'asc' });
    expect(query.where).toMatchObject({
      active: true,
      account: { none: {} },
      dependent_profile: {
        is: { frozen_at: null, purged_at: null, teen_login_nudged_at: null },
      },
      birthday: { not: null },
    });
    expect(query.where.OR).toEqual([
      { supervised_login: { is: null } },
      { supervised_login: { is: { disabled_at: { not: null } } } },
    ]);
  });

  it('the next day: the dependent is no longer returned (flag set), so nothing is sent again', async () => {
    const ctx = setup();
    withCandidates(ctx, [candidate(ANA, '2013-10-20')]);
    await ctx.service.run(NOW);
    expect(ctx.notifications.sendToUser).toHaveBeenCalledTimes(1);

    // Second run: the database filter on teen_login_nudged_at IS NULL drops it.
    const next = new Date(NOW.getTime() + DAY_MS);
    await ctx.service.run(next);

    expect(ctx.notifications.sendToUser).toHaveBeenCalledTimes(1);
  });

  it('a dependent who turns 13 TOMORROW is not nudged today and keeps the flag NULL', async () => {
    const ctx = setup();
    withCandidates(ctx, [candidate(ANA, '2013-10-21')]);

    const summary = await ctx.service.run(NOW);

    expect(summary.nudged).toBe(0);
    expect(ctx.security.recipientsOf).not.toHaveBeenCalled();
    expect(ctx.notifications.sendToUser).not.toHaveBeenCalled();
    expect(ctx.prisma.dependent_profiles.updateMany).not.toHaveBeenCalled();
  });

  it("decides by the dependent's local calendar day: Mexico City is still the 20th when UTC is already the 21st", async () => {
    const ctx = setup();
    const lateUtc = new Date('2026-10-21T03:00:00.000Z'); // 21:00 on the 20th in Mexico
    withCandidates(ctx, [candidate(ANA, '2013-10-21')]);

    const summary = await ctx.service.run(lateUtc);

    expect(summary.nudged).toBe(0);
    expect(ctx.notifications.sendToUser).not.toHaveBeenCalled();
  });

  it("decides by the dependent's local calendar day: Auckland is already the 21st at 14:00 UTC on the 20th", async () => {
    const ctx = setup();
    withCandidates(ctx, [candidate(ANA, '2013-10-21', { country_id: 2 })]);

    const summary = await ctx.service.run(NOW);

    expect(summary.nudged).toBe(1);
    expect(ctx.notifications.sendToUser).toHaveBeenCalledTimes(1);
  });

  it('catches up after a 3-day outage: age 13 for 3 days with the flag NULL is nudged ONCE', async () => {
    const ctx = setup();
    withCandidates(ctx, [candidate(ANA, '2013-10-17')]);

    const first = await ctx.service.run(NOW);
    expect(first.nudged).toBe(1);

    // The claim already set the flag: a second run (or a second instance that
    // read the row before the claim) loses the compare-and-set.
    withCandidates(ctx, [candidate(ANA, '2013-10-17')]);
    ctx.prisma.dependent_profiles.updateMany.mockResolvedValue({ count: 0 });
    const second = await ctx.service.run(NOW);

    expect(second.nudged).toBe(0);
    expect(ctx.notifications.sendToUser).toHaveBeenCalledTimes(1);
  });

  it('notifies ALL verified guardians and sets the flag ONCE', async () => {
    const ctx = setup();
    ctx.security.recipientsOf.mockResolvedValue({
      firstName: 'Ana',
      guardianIds: [G1, G2],
    });
    withCandidates(ctx, [candidate(ANA, '2013-10-20')]);

    const summary = await ctx.service.run(NOW);

    expect(summary.nudged).toBe(1);
    const recipients = ctx.notifications.sendToUser.mock.calls.map(
      (call: any[]) => call[0].userId,
    );
    expect(recipients).toEqual([G1, G2]);
    expect(ctx.prisma.dependent_profiles.updateMany).toHaveBeenCalledTimes(1);
  });

  it.each([['pending, custodian-only or no verified guardian', null]])(
    '%s: skipped, nothing claimed, so it is nudged later once verified',
    async (_label, recipients) => {
      const ctx = setup();
      ctx.security.recipientsOf.mockResolvedValue(recipients);
      withCandidates(ctx, [candidate(ANA, '2013-10-20')]);

      const summary = await ctx.service.run(NOW);

      expect(summary.nudged).toBe(0);
      expect(summary.skippedNoGuardian).toBe(1);
      expect(ctx.notifications.sendToUser).not.toHaveBeenCalled();
      expect(ctx.prisma.dependent_profiles.updateMany).not.toHaveBeenCalled();
    },
  );

  it('later, once a guardian is verified, the same dependent IS nudged (triangulation of the skip)', async () => {
    const ctx = setup();
    ctx.security.recipientsOf.mockResolvedValueOnce(null);
    withCandidates(ctx, [candidate(ANA, '2013-10-20')]);
    await ctx.service.run(NOW);
    expect(ctx.notifications.sendToUser).not.toHaveBeenCalled();

    ctx.security.recipientsOf.mockResolvedValue({
      firstName: 'Ana',
      guardianIds: [G1],
    });
    withCandidates(ctx, [candidate(ANA, '2013-10-20')]);
    const next = new Date(NOW.getTime() + DAY_MS);
    await ctx.service.run(next);

    expect(ctx.notifications.sendToUser).toHaveBeenCalledTimes(1);
  });

  it('a dependent that already has an ENABLED supervised login is never nudged (defense in depth over the query)', async () => {
    const ctx = setup();
    withCandidates(ctx, [
      candidate(ANA, '2013-10-20', { supervised_login: { disabled_at: null } }),
    ]);

    const summary = await ctx.service.run(NOW);

    expect(summary.nudged).toBe(0);
    expect(ctx.security.recipientsOf).not.toHaveBeenCalled();
    expect(ctx.notifications.sendToUser).not.toHaveBeenCalled();
  });

  it('a dependent whose login was DISABLED is still eligible', async () => {
    const ctx = setup();
    withCandidates(ctx, [
      candidate(ANA, '2013-10-20', {
        supervised_login: { disabled_at: new Date('2026-09-01T00:00:00Z') },
      }),
    ]);

    const summary = await ctx.service.run(NOW);

    expect(summary.nudged).toBe(1);
  });

  it.each([
    ['12 (below the minimum age)', '2014-10-21'],
    ['18 (of age)', '2008-10-20'],
    ['no birthday', null],
  ])('age %s is not nudged', async (_label, birthday) => {
    const ctx = setup();
    withCandidates(ctx, [candidate(ANA, birthday)]);

    const summary = await ctx.service.run(NOW);

    expect(summary.nudged).toBe(0);
    expect(ctx.notifications.sendToUser).not.toHaveBeenCalled();
  });

  it('follows the country policy: majority 16 stops the nudge at 16', async () => {
    const ctx = setup();
    withCandidates(ctx, [
      candidate(ANA, '2010-10-20', { country_id: 3 }), // 16 today
      candidate(LUIS, '2012-10-20', { country_id: 3 }), // 14
    ]);
    ctx.security.recipientsOf.mockResolvedValue({
      firstName: 'Luis',
      guardianIds: [G1],
    });

    const summary = await ctx.service.run(NOW);

    expect(summary.nudged).toBe(1);
    expect(ctx.security.recipientsOf).toHaveBeenCalledTimes(1);
    expect(ctx.security.recipientsOf).toHaveBeenCalledWith(LUIS);
  });

  it('two instances: the one that loses the claim sends nothing', async () => {
    const ctx = setup();
    ctx.prisma.dependent_profiles.updateMany.mockResolvedValue({ count: 0 });
    withCandidates(ctx, [candidate(ANA, '2013-10-20')]);

    const summary = await ctx.service.run(NOW);

    expect(summary.nudged).toBe(0);
    expect(ctx.notifications.sendToUser).not.toHaveBeenCalled();
  });

  it('flag FAMILY_TEEN_LOGIN_ENABLED off: sends nothing, sets nothing (the candidates are not even read)', async () => {
    const ctx = setup();
    ctx.flags.isEnabled.mockReturnValue(false);
    withCandidates(ctx, [candidate(ANA, '2013-10-20')]);

    const summary = await ctx.service.run(NOW);

    expect(ctx.flags.isEnabled).toHaveBeenCalledWith('teen_login');
    expect(summary.nudged).toBe(0);
    expect(ctx.prisma.users.findMany).not.toHaveBeenCalled();
    expect(ctx.notifications.sendToUser).not.toHaveBeenCalled();
    expect(ctx.prisma.dependent_profiles.updateMany).not.toHaveBeenCalled();
  });

  it('flag off still runs the device sweep (it is not flagged)', async () => {
    const ctx = setup();
    ctx.flags.isEnabled.mockReturnValue(false);
    withDevices(ctx, [device(DEV_A, ANA, '2008-10-20')]);

    await ctx.service.run(NOW);

    expect(ctx.linkedDevices.revokeBySystem).toHaveBeenCalledTimes(1);
  });

  it('when every send fails the claim is given back so the next run retries, and the dependent counts as failed', async () => {
    const ctx = setup();
    withCandidates(ctx, [candidate(ANA, '2013-10-20')]);
    ctx.notifications.sendToUser.mockRejectedValue(new Error('queue down'));

    const summary = await ctx.service.run(NOW);

    expect(summary.nudged).toBe(0);
    expect(summary.failed).toBe(1);
    expect(ctx.prisma.dependent_profiles.updateMany).toHaveBeenLastCalledWith({
      where: { user_id: ANA, teen_login_nudged_at: NOW },
      data: { teen_login_nudged_at: null },
    });
  });

  it('one guardian failing does not undo the nudge of the other (an attempt was delivered)', async () => {
    const ctx = setup();
    ctx.security.recipientsOf.mockResolvedValue({
      firstName: 'Ana',
      guardianIds: [G1, G2],
    });
    ctx.notifications.sendToUser
      .mockRejectedValueOnce(new Error('one down'))
      .mockResolvedValueOnce({});
    withCandidates(ctx, [candidate(ANA, '2013-10-20')]);

    const summary = await ctx.service.run(NOW);

    expect(summary.nudged).toBe(1);
    expect(summary.failed).toBe(0);
    expect(ctx.prisma.dependent_profiles.updateMany).toHaveBeenCalledTimes(1);
  });

  it('reads in batches of 100 by user id cursor and stops on a short page', async () => {
    const ctx = setup();
    const page = Array.from({ length: 100 }, (_v, i) =>
      candidate(`aaaaaaaa-0000-4000-8000-${String(i).padStart(12, '0')}`, null),
    );
    ctx.prisma.users.findMany
      .mockResolvedValueOnce(page)
      .mockResolvedValueOnce([
        candidate('ffffffff-0000-4000-8000-000000000000', null),
      ]);

    await ctx.service.run(NOW);

    expect(ctx.prisma.users.findMany).toHaveBeenCalledTimes(2);
    expect(
      ctx.prisma.users.findMany.mock.calls[0][0].where.user_id,
    ).toBeUndefined();
    expect(ctx.prisma.users.findMany.mock.calls[1][0].where.user_id).toEqual({
      gt: page[99].user_id,
    });
  });

  it('a failure on one dependent does not stop the next one', async () => {
    const ctx = setup();
    withCandidates(ctx, [
      candidate(ANA, '2013-10-20'),
      candidate(LUIS, '2013-10-20'),
    ]);
    ctx.security.recipientsOf
      .mockRejectedValueOnce(new Error('read failed'))
      .mockResolvedValueOnce({ firstName: 'Luis', guardianIds: [G1] });

    const summary = await ctx.service.run(NOW);

    expect(summary.failed).toBe(1);
    expect(summary.nudged).toBe(1);
  });

  it('never touches the devices of a child who turns 13 (it only nudges)', async () => {
    const ctx = setup();
    withCandidates(ctx, [candidate(ANA, '2013-10-20')]);
    withDevices(ctx, [device(DEV_A, ANA, '2013-10-20')]);

    await ctx.service.run(NOW);

    expect(ctx.notifications.sendToUser).toHaveBeenCalledTimes(1);
    expect(ctx.linkedDevices.revokeBySystem).not.toHaveBeenCalled();
  });
});

describe('FamilyAgeTransitionsCronService device sweep (B15)', () => {
  it('a device whose child turned 18 today is revoked with reason majority', async () => {
    const ctx = setup();
    withDevices(ctx, [device(DEV_A, ANA, '2008-10-20')]);

    const summary = await ctx.service.run(NOW);

    expect(summary.majorityRevoked).toBe(1);
    expect(ctx.linkedDevices.revokeBySystem).toHaveBeenCalledTimes(1);
    expect(ctx.linkedDevices.revokeBySystem).toHaveBeenCalledWith(
      expect.objectContaining({
        dependentId: ANA,
        reason: 'majority',
        precondition: expect.any(Function),
      }),
    );
  });

  it('the day before the 18th birthday nothing is revoked', async () => {
    const ctx = setup();
    withDevices(ctx, [device(DEV_A, ANA, '2008-10-21')]);

    const summary = await ctx.service.run(NOW);

    expect(summary.majorityRevoked).toBe(0);
    expect(ctx.linkedDevices.revokeBySystem).not.toHaveBeenCalled();
  });

  it('a child who just turned 13 keeps the device', async () => {
    const ctx = setup();
    withDevices(ctx, [device(DEV_A, ANA, '2013-10-20')]);

    await ctx.service.run(NOW);

    expect(ctx.linkedDevices.revokeBySystem).not.toHaveBeenCalled();
  });

  it('majority follows the country policy (16) and the local calendar day', async () => {
    const ctx = setup();
    withDevices(ctx, [
      device(DEV_A, ANA, '2010-10-20', {
        dependent: { birthday: day('2010-10-20'), country_id: 3 },
      }),
      device(DEV_B, LUIS, '2008-10-21', {
        dependent: { birthday: day('2008-10-21'), country_id: 2 }, // Auckland: already the 21st
      }),
    ]);

    const summary = await ctx.service.run(NOW);

    expect(summary.majorityRevoked).toBe(2);
    expect(
      ctx.linkedDevices.revokeBySystem.mock.calls.map(
        (c: any[]) => c[0].dependentId,
      ),
    ).toEqual([ANA, LUIS]);
  });

  it('two devices of the same child past majority are ONE revoke call (the service revokes them all, one notice per device)', async () => {
    const ctx = setup();
    withDevices(ctx, [
      device(DEV_A, ANA, '2008-10-20'),
      device(DEV_B, ANA, '2008-10-20'),
    ]);

    await ctx.service.run(NOW);

    expect(ctx.linkedDevices.revokeBySystem).toHaveBeenCalledTimes(1);
  });

  it('a device past its absolute cap is revoked with reason expired (that device only)', async () => {
    const ctx = setup();
    withDevices(ctx, [
      device(DEV_A, LUIS, '2016-05-01', {
        absolute_expires_at: new Date(NOW.getTime() - 1000),
      }),
      device(DEV_B, LUIS, '2016-05-01'), // still inside the cap
    ]);

    const summary = await ctx.service.run(NOW);

    expect(summary.expiredRevoked).toBe(1);
    expect(ctx.linkedDevices.revokeBySystem).toHaveBeenCalledTimes(1);
    expect(ctx.linkedDevices.revokeBySystem).toHaveBeenCalledWith({
      dependentId: LUIS,
      deviceId: DEV_A,
      reason: 'expired',
      now: NOW,
    });
  });

  it('a device that is both past majority and past its cap is revoked ONCE (majority wins)', async () => {
    const ctx = setup();
    withDevices(ctx, [
      device(DEV_A, ANA, '2008-10-20', {
        absolute_expires_at: new Date(NOW.getTime() - 1000),
      }),
    ]);

    await ctx.service.run(NOW);

    expect(ctx.linkedDevices.revokeBySystem).toHaveBeenCalledTimes(1);
    expect(ctx.linkedDevices.revokeBySystem.mock.calls[0][0].reason).toBe(
      'majority',
    );
  });

  it('the majority precondition re-reads the birthday under the lock: a correction wins over the stale scan', async () => {
    const ctx = setup();
    withDevices(ctx, [device(DEV_A, ANA, '2008-10-20')]);
    await ctx.service.run(NOW);
    const { precondition } = ctx.linkedDevices.revokeBySystem.mock.calls[0][0];

    ctx.tx.users.findUnique.mockResolvedValueOnce({
      birthday: day('2008-10-20'),
      country_id: 1,
    });
    await expect(precondition(ctx.tx)).resolves.toBe(true);

    ctx.tx.users.findUnique.mockResolvedValueOnce({
      birthday: day('2012-01-01'), // corrected: now a minor
      country_id: 1,
    });
    await expect(precondition(ctx.tx)).resolves.toBe(false);

    ctx.tx.users.findUnique.mockResolvedValueOnce({
      birthday: null,
      country_id: 1,
    });
    await expect(precondition(ctx.tx)).resolves.toBe(false);
  });

  it('a revoke that finds nothing (the request gate got there first) is not counted', async () => {
    const ctx = setup();
    ctx.linkedDevices.revokeBySystem.mockResolvedValue(0);
    withDevices(ctx, [device(DEV_A, ANA, '2008-10-20')]);

    const summary = await ctx.service.run(NOW);

    expect(summary.majorityRevoked).toBe(0);
  });

  it('a device whose child has no birthday is left to the request gate (no age to reason about)', async () => {
    const ctx = setup();
    withDevices(ctx, [device(DEV_A, ANA, null)]);

    await ctx.service.run(NOW);

    expect(ctx.linkedDevices.revokeBySystem).not.toHaveBeenCalled();
  });

  it('scans only ACTIVE devices, in batches of 100 by device id cursor', async () => {
    const ctx = setup();
    const page = Array.from({ length: 100 }, (_v, i) =>
      device(
        `cccccccc-0000-4000-8000-${String(i).padStart(12, '0')}`,
        `aaaaaaaa-0000-4000-8000-${String(i).padStart(12, '0')}`,
        '2016-05-01',
      ),
    );
    ctx.prisma.linked_devices.findMany
      .mockResolvedValueOnce(page)
      .mockResolvedValueOnce([]);

    await ctx.service.run(NOW);

    expect(ctx.prisma.linked_devices.findMany).toHaveBeenCalledTimes(2);
    const first = ctx.prisma.linked_devices.findMany.mock.calls[0][0];
    expect(first.where).toEqual({ revoked_at: null });
    expect(first.take).toBe(100);
    expect(ctx.prisma.linked_devices.findMany.mock.calls[1][0].where).toEqual({
      revoked_at: null,
      linked_device_id: { gt: page[99].linked_device_id },
    });
  });

  it('a failing revoke is counted and does not stop the rest of the sweep', async () => {
    const ctx = setup();
    withDevices(ctx, [
      device(DEV_A, ANA, '2008-10-20'),
      device(DEV_B, LUIS, '2008-10-20'),
    ]);
    ctx.linkedDevices.revokeBySystem
      .mockRejectedValueOnce(new Error('db down'))
      .mockResolvedValueOnce(1);

    const summary = await ctx.service.run(NOW);

    expect(summary.failed).toBe(1);
    expect(summary.majorityRevoked).toBe(1);
  });

  it('the request gate AGREES with the sweep: the same child at 18 today is refused with AUTH_DEVICE_REVOKED', async () => {
    const ctx = setup();
    withDevices(ctx, [device(DEV_A, ANA, '2008-10-20')]);
    await ctx.service.run(NOW);
    expect(ctx.linkedDevices.revokeBySystem).toHaveBeenCalledTimes(1);

    jest.useFakeTimers({ now: NOW });
    try {
      const prisma: any = {
        linked_devices: {
          findFirst: jest.fn().mockResolvedValue({
            linked_device_id: DEV_A,
            guardianship_id: 'gs-1',
            revoked_at: null,
            absolute_expires_at: new Date(NOW.getTime() + 100 * DAY_MS),
            guardianship: {
              consent_status: 'verified',
              is_custodian: false,
              is_test_data: false,
              revoked_at: null,
              guardian_user_id: G1,
            },
            dependent: {
              active: true,
              birthday: day('2008-10-20'),
              country_id: 1,
              dependent_profile: { frozen_at: null, purged_at: null },
              supervised_login: null,
            },
          }),
          updateMany: jest.fn(),
        },
        session: {
          findFirst: jest
            .fn()
            .mockResolvedValue({ expiresAt: new Date(NOW.getTime() + DAY_MS) }),
        },
      };
      const gate = new LinkedDeviceGate(
        prisma,
        { get: jest.fn().mockResolvedValue(null), set: jest.fn() } as any,
        {
          getEpoch: jest.fn().mockResolvedValue(1),
          initEpoch: jest.fn().mockResolvedValue(1),
        } as any,
        { isEnabled: jest.fn().mockReturnValue(true) } as any,
        ctx.agePolicy as any,
        {
          revokeStandalone: jest.fn().mockResolvedValue([]),
          announceAutoRevoked: jest.fn(),
        } as any,
      );

      await expect(
        gate.assertActive({ dependentId: ANA, sid: 'sid-1', deviceId: DEV_A }),
      ).rejects.toMatchObject({ code: ErrorCode.AUTH_DEVICE_REVOKED });
    } finally {
      jest.useRealTimers();
    }
  });
});
