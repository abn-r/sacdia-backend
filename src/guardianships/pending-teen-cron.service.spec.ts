import {
  PENDING_TEEN_JOB,
  PendingTeenCronService,
  dueReminderLevel,
} from './pending-teen-cron.service';

const DAY = 24 * 60 * 60 * 1000;
const NOW = new Date('2026-10-19T12:00:00.000Z');
const TEEN = 'aaaaaaaa-0000-4000-8000-000000000001';
const TEEN2 = 'aaaaaaaa-0000-4000-8000-000000000002';

const daysAgo = (days: number) => new Date(NOW.getTime() - days * DAY);
/** Born 15 years before NOW. */
const MINOR_BIRTHDAY = new Date('2011-03-01T00:00:00.000Z');
const ADULT_BIRTHDAY = new Date('2000-03-01T00:00:00.000Z');

interface LoginRow {
  user_id: string;
  pending_since: Date | null;
  pending_reminder_level: number;
  user?: Partial<{
    birthday: Date | null;
    country_id: number | null;
    active: boolean;
    dependent_profile: {
      frozen_at: Date | null;
      purged_at: Date | null;
    } | null;
  }>;
}

function login(row: LoginRow) {
  return {
    user_id: row.user_id,
    pending_since: row.pending_since,
    pending_reminder_level: row.pending_reminder_level,
    user: {
      birthday: MINOR_BIRTHDAY,
      country_id: 1,
      active: true,
      dependent_profile: null,
      ...row.user,
    },
  };
}

function setup() {
  const tx: any = {
    $executeRaw: jest.fn().mockResolvedValue(1),
    supervised_logins: {
      findUnique: jest.fn(),
      update: jest.fn().mockResolvedValue({}),
    },
    guardianships: { count: jest.fn().mockResolvedValue(0) },
    dependent_profiles: { upsert: jest.fn().mockResolvedValue({}) },
    session: { deleteMany: jest.fn().mockResolvedValue({ count: 2 }) },
  };
  const prisma: any = {
    users: { findMany: jest.fn().mockResolvedValue([]) },
    supervised_logins: {
      findMany: jest.fn().mockResolvedValue([]),
      createMany: jest.fn().mockResolvedValue({ count: 1 }),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    guardianships: { count: jest.fn().mockResolvedValue(0) },
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
  const cache = { bump: jest.fn().mockResolvedValue(undefined) };
  const notifications = { sendToUser: jest.fn().mockResolvedValue({}) };
  const agePolicy = {
    getPolicy: jest.fn().mockResolvedValue({
      minSelfLoginAge: 13,
      ageOfMajority: 18,
      timeZone: 'America/Mexico_City',
    }),
  };
  const blacklist = {
    blacklistAllUserTokens: jest.fn().mockResolvedValue(undefined),
  };
  const revoker = { revokeAllForDependent: jest.fn().mockResolvedValue(0) };
  const service = new PendingTeenCronService(
    prisma,
    lock as any,
    cronLogger as any,
    cache as any,
    notifications as any,
    agePolicy as any,
    blacklist as any,
    revoker as any,
  );
  return {
    service,
    prisma,
    tx,
    lock,
    cronLogger,
    cache,
    notifications,
    agePolicy,
    blacklist,
    revoker,
  };
}

function withRows(ctx: ReturnType<typeof setup>, rows: LoginRow[]) {
  ctx.prisma.supervised_logins.findMany
    .mockResolvedValueOnce(rows.map(login))
    .mockResolvedValue([]);
}

describe('PendingTeenCronService scheduling and locking', () => {
  it('runs daily at 04:40 UTC under the documented job name', () => {
    const metadata = (key: string) =>
      Reflect.getMetadata(key, PendingTeenCronService.prototype.handleDaily);
    expect(PENDING_TEEN_JOB).toBe('pending-teen-guardian');
    expect(metadata('SCHEDULE_CRON_OPTIONS')).toMatchObject({
      cronTime: '40 4 * * *',
      name: 'pending-teen-guardian',
      timeZone: 'UTC',
    });
  });

  it('takes the 23h lock, tracks the run and always releases', async () => {
    const { service, lock, cronLogger } = setup();
    await service.handleDaily();
    expect(lock.tryAcquire).toHaveBeenCalledWith(
      'cron:pending-teen-guardian',
      23 * 60 * 60 * 1000,
    );
    expect(cronLogger.track).toHaveBeenCalledWith(
      'pending-teen-guardian',
      expect.any(Function),
    );
    expect(lock.release).toHaveBeenCalledWith('cron:pending-teen-guardian');
  });

  it('two instances, one runner: the loser records a skip and touches nothing', async () => {
    const { service, lock, cronLogger, prisma } = setup();
    lock.tryAcquire.mockResolvedValue(false);

    await service.handleDaily();

    expect(cronLogger.trackSkipped).toHaveBeenCalledWith(
      'pending-teen-guardian',
      'lock_not_acquired',
    );
    expect(cronLogger.track).not.toHaveBeenCalled();
    expect(prisma.users.findMany).not.toHaveBeenCalled();
    expect(prisma.supervised_logins.findMany).not.toHaveBeenCalled();
    expect(lock.release).not.toHaveBeenCalled();
  });

  it('releases the lock even when the run blows up', async () => {
    const { service, lock, cronLogger } = setup();
    cronLogger.track.mockRejectedValue(new Error('boom'));
    await expect(service.handleDaily()).resolves.toBeUndefined();
    expect(lock.release).toHaveBeenCalled();
  });

  it('fails the run when a teen could not be processed', async () => {
    const ctx = setup();
    ctx.prisma.supervised_logins.findMany.mockRejectedValue(new Error('db'));
    await ctx.service.handleDaily();
    const trackFn = ctx.cronLogger.track.mock
      .calls[0][1] as () => Promise<unknown>;
    await expect(trackFn()).rejects.toThrow('db');
  });
});

describe('dueReminderLevel', () => {
  it.each([
    [0, 0],
    [6, 0],
    [7, 1],
    [29, 1],
    [30, 2],
    [82, 2],
    [83, 3],
    [89, 3],
  ])('day %i is level %i', (days, level) => {
    expect(dueReminderLevel(days)).toBe(level);
  });
});

describe('PendingTeenCronService clock start', () => {
  it('starts the clock at the first evaluation, never freezing an old account', async () => {
    const ctx = setup();
    ctx.prisma.users.findMany.mockResolvedValueOnce([
      { user_id: TEEN, birthday: MINOR_BIRTHDAY, country_id: 1 },
    ]);
    // An account created 120 days ago has NO supervised row yet.

    const summary = await ctx.service.run(NOW);

    expect(summary).toMatchObject({ clocksStarted: 1, frozen: 0, failed: 0 });
    const data = ctx.prisma.supervised_logins.createMany.mock.calls[0][0];
    expect(data.skipDuplicates).toBe(true);
    expect(data.data[0]).toMatchObject({
      user_id: TEEN,
      origin: 'self_registered',
      pending_since: NOW,
      pending_reminder_level: 0,
    });
    expect(ctx.tx.dependent_profiles.upsert).not.toHaveBeenCalled();
  });

  it('skips adults and creates the row without a clock for a linked guardian', async () => {
    const ctx = setup();
    ctx.prisma.users.findMany.mockResolvedValueOnce([
      { user_id: TEEN, birthday: ADULT_BIRTHDAY, country_id: 1 },
      { user_id: TEEN2, birthday: MINOR_BIRTHDAY, country_id: 1 },
    ]);
    ctx.prisma.guardianships.count.mockResolvedValue(1);

    await ctx.service.run(NOW);

    const calls = ctx.prisma.supervised_logins.createMany.mock.calls;
    expect(calls).toHaveLength(1);
    expect(calls[0][0].data[0]).toMatchObject({
      user_id: TEEN2,
      pending_since: null,
    });
  });

  it('only looks at account holders without a dependent profile or a row', async () => {
    const ctx = setup();
    await ctx.service.run(NOW);
    const where = ctx.prisma.users.findMany.mock.calls[0][0].where;
    expect(where).toMatchObject({
      active: true,
      supervised_login: { is: null },
      dependent_profile: { is: null },
      account: { some: {} },
    });
  });
});

describe('PendingTeenCronService reminders', () => {
  it.each([
    [7, 0, 1],
    [30, 1, 2],
    [83, 2, 3],
  ])(
    'day %i sends reminder level %i -> %i to the teen only',
    async (days, from, to) => {
      const ctx = setup();
      withRows(ctx, [
        {
          user_id: TEEN,
          pending_since: daysAgo(days),
          pending_reminder_level: from,
        },
      ]);

      const summary = await ctx.service.run(NOW);

      expect(summary.reminders).toBe(1);
      expect(ctx.prisma.supervised_logins.updateMany).toHaveBeenCalledWith({
        where: expect.objectContaining({
          user_id: TEEN,
          pending_reminder_level: { lt: to },
        }),
        data: { pending_reminder_level: to },
      });
      const [dto, sentBy, source] = ctx.notifications.sendToUser.mock.calls[0];
      expect(dto.userId).toBe(TEEN);
      expect(dto.body).toContain(`${90 - days} días`);
      expect(sentBy).toBe('system');
      expect(source).toBe('family:teen_reminder');
    },
  );

  it('after an outage only the LATEST due reminder is sent, once', async () => {
    const ctx = setup();
    withRows(ctx, [
      { user_id: TEEN, pending_since: daysAgo(45), pending_reminder_level: 0 },
    ]);

    await ctx.service.run(NOW);

    expect(ctx.notifications.sendToUser).toHaveBeenCalledTimes(1);
    expect(ctx.prisma.supervised_logins.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: { pending_reminder_level: 2 } }),
    );
  });

  it('same-day dedupe: a level already sent is not sent again', async () => {
    const ctx = setup();
    withRows(ctx, [
      { user_id: TEEN, pending_since: daysAgo(8), pending_reminder_level: 1 },
    ]);
    await ctx.service.run(NOW);
    expect(ctx.notifications.sendToUser).not.toHaveBeenCalled();
    expect(ctx.prisma.supervised_logins.updateMany).not.toHaveBeenCalled();
  });

  it('two instances: the one that loses the compare-and-set sends nothing', async () => {
    const ctx = setup();
    ctx.prisma.supervised_logins.updateMany.mockResolvedValue({ count: 0 });
    withRows(ctx, [
      { user_id: TEEN, pending_since: daysAgo(8), pending_reminder_level: 0 },
    ]);
    const summary = await ctx.service.run(NOW);
    expect(summary.reminders).toBe(0);
    expect(ctx.notifications.sendToUser).not.toHaveBeenCalled();
  });

  it('gives the level back when the send fails so the next run retries', async () => {
    const ctx = setup();
    ctx.notifications.sendToUser.mockRejectedValue(new Error('fcm'));
    withRows(ctx, [
      { user_id: TEEN, pending_since: daysAgo(8), pending_reminder_level: 0 },
    ]);

    const summary = await ctx.service.run(NOW);

    expect(summary.failed).toBe(1);
    expect(ctx.prisma.supervised_logins.updateMany).toHaveBeenLastCalledWith({
      where: { user_id: TEEN, pending_reminder_level: 1 },
      data: { pending_reminder_level: 0 },
    });
  });

  it('a guardian linked on day 60 (even pending) stops reminders and the freeze', async () => {
    const ctx = setup();
    ctx.prisma.guardianships.count.mockResolvedValue(1);
    withRows(ctx, [
      { user_id: TEEN, pending_since: daysAgo(95), pending_reminder_level: 3 },
    ]);

    const summary = await ctx.service.run(NOW);

    expect(summary).toMatchObject({ reminders: 0, frozen: 0 });
    expect(ctx.prisma.$transaction).not.toHaveBeenCalled();
  });

  it('a clock restarted on day 70 (revoked link) neither reminds nor freezes', async () => {
    const ctx = setup();
    withRows(ctx, [
      { user_id: TEEN, pending_since: daysAgo(0), pending_reminder_level: 0 },
    ]);
    const summary = await ctx.service.run(NOW);
    expect(summary).toMatchObject({ reminders: 0, frozen: 0, failed: 0 });
  });

  it('never touches a person who reached the age of majority', async () => {
    const ctx = setup();
    withRows(ctx, [
      {
        user_id: TEEN,
        pending_since: daysAgo(95),
        pending_reminder_level: 3,
        user: { birthday: ADULT_BIRTHDAY },
      },
    ]);
    const summary = await ctx.service.run(NOW);
    expect(summary).toMatchObject({ reminders: 0, frozen: 0 });
    expect(ctx.prisma.$transaction).not.toHaveBeenCalled();
  });

  it('skips a teen already frozen or disabled', async () => {
    const ctx = setup();
    withRows(ctx, [
      {
        user_id: TEEN,
        pending_since: daysAgo(95),
        pending_reminder_level: 3,
        user: { dependent_profile: { frozen_at: daysAgo(1), purged_at: null } },
      },
    ]);
    await ctx.service.run(NOW);
    expect(ctx.prisma.$transaction).not.toHaveBeenCalled();
    // The query itself excludes disabled rows.
    expect(
      ctx.prisma.supervised_logins.findMany.mock.calls[0][0].where,
    ).toMatchObject({ pending_since: { not: null }, disabled_at: null });
  });
});

describe('PendingTeenCronService freeze at day 90', () => {
  function frozenSetup(days = 90) {
    const ctx = setup();
    const since = daysAgo(days);
    ctx.tx.supervised_logins.findUnique.mockResolvedValue({
      pending_since: since,
      disabled_at: null,
    });
    withRows(ctx, [
      { user_id: TEEN, pending_since: since, pending_reminder_level: 3 },
    ]);
    return ctx;
  }

  it('freezes in ONE transaction with purge_after = now + 90 days', async () => {
    const ctx = frozenSetup();

    const summary = await ctx.service.run(NOW);

    expect(summary.frozen).toBe(1);
    expect(ctx.prisma.$transaction).toHaveBeenCalledTimes(1);
    const upsert = ctx.tx.dependent_profiles.upsert.mock.calls[0][0];
    expect(upsert.where).toEqual({ user_id: TEEN });
    expect(upsert.create).toMatchObject({
      user_id: TEEN,
      created_by_user_id: TEEN,
      frozen_at: NOW,
      purge_after: new Date(NOW.getTime() + 90 * DAY),
    });
    expect(upsert.update).toMatchObject({
      frozen_at: NOW,
      purge_after: new Date(NOW.getTime() + 90 * DAY),
    });
    expect(ctx.tx.supervised_logins.update).toHaveBeenCalledWith({
      where: { user_id: TEEN },
      data: {
        disabled_at: NOW,
        disabled_reason: 'unlinked_purged',
        disabled_by_user_id: null,
      },
    });
    expect(ctx.tx.session.deleteMany).toHaveBeenCalledWith({
      where: { userId: TEEN },
    });
    expect(ctx.revoker.revokeAllForDependent).toHaveBeenCalledWith(
      ctx.tx,
      TEEN,
      'dependent_frozen',
    );
    expect(ctx.tx.$executeRaw).toHaveBeenCalled();
    // After the commit.
    expect(ctx.blacklist.blacklistAllUserTokens).toHaveBeenCalledWith(
      TEEN,
      28_800,
    );
    expect(ctx.cache.bump).toHaveBeenCalledWith(TEEN);
    expect(ctx.notifications.sendToUser).not.toHaveBeenCalled();
  });

  it('day 89 is not frozen yet (it gets the day-83 reminder instead)', async () => {
    const ctx = setup();
    withRows(ctx, [
      { user_id: TEEN, pending_since: daysAgo(89), pending_reminder_level: 2 },
    ]);
    const summary = await ctx.service.run(NOW);
    expect(summary.frozen).toBe(0);
    expect(summary.reminders).toBe(1);
    expect(ctx.prisma.$transaction).not.toHaveBeenCalled();
  });

  it('a guardian linked between the read and the lock wins over the freeze', async () => {
    const ctx = frozenSetup();
    ctx.tx.guardianships.count.mockResolvedValue(1);

    const summary = await ctx.service.run(NOW);

    expect(summary.frozen).toBe(0);
    expect(ctx.tx.dependent_profiles.upsert).not.toHaveBeenCalled();
    expect(ctx.cache.bump).not.toHaveBeenCalled();
  });

  it('a clock restarted between the read and the lock wins over the freeze', async () => {
    const ctx = frozenSetup();
    ctx.tx.supervised_logins.findUnique.mockResolvedValue({
      pending_since: daysAgo(1),
      disabled_at: null,
    });
    const summary = await ctx.service.run(NOW);
    expect(summary.frozen).toBe(0);
    expect(ctx.tx.dependent_profiles.upsert).not.toHaveBeenCalled();
  });

  it('a transaction failure rolls the whole freeze back and fails the teen only', async () => {
    const ctx = frozenSetup();
    ctx.tx.session.deleteMany.mockRejectedValue(new Error('deadlock'));
    const summary = await ctx.service.run(NOW);
    expect(summary).toMatchObject({ frozen: 0, failed: 1 });
    expect(ctx.cache.bump).not.toHaveBeenCalled();
  });

  it('a blacklist outage after the commit does not undo the freeze', async () => {
    const ctx = frozenSetup();
    ctx.blacklist.blacklistAllUserTokens.mockRejectedValue(new Error('redis'));
    const summary = await ctx.service.run(NOW);
    expect(summary.frozen).toBe(1);
    expect(ctx.cache.bump).toHaveBeenCalledWith(TEEN);
  });

  it('one failing teen does not stop the others', async () => {
    const ctx = setup();
    ctx.notifications.sendToUser
      .mockRejectedValueOnce(new Error('fcm'))
      .mockResolvedValue({});
    withRows(ctx, [
      { user_id: TEEN, pending_since: daysAgo(8), pending_reminder_level: 0 },
      { user_id: TEEN2, pending_since: daysAgo(8), pending_reminder_level: 0 },
    ]);
    const summary = await ctx.service.run(NOW);
    expect(summary).toMatchObject({ reminders: 1, failed: 1 });
  });
});
