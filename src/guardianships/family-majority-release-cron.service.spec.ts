import { Logger } from '@nestjs/common';
import {
  FAMILY_MAJORITY_RELEASE_JOB,
  FamilyMajorityReleaseCronService,
  MAJORITY_FROZEN_SOURCE,
  MAJORITY_HANDOVER_SOURCE,
  MAJORITY_NOTICE_SOURCE,
  MAJORITY_RELEASED_SOURCE,
  MAJORITY_REMINDER_SOURCE,
} from './family-majority-release-cron.service';

// 09:30 UTC = 03:30 in Mexico City (the cron schedule). Mexico has no DST.
const NOW = new Date('2026-11-12T09:30:00.000Z');
const DAY_MS = 24 * 60 * 60 * 1000;
const MEXICO = {
  minSelfLoginAge: 13,
  ageOfMajority: 18,
  timeZone: 'America/Mexico_City',
};
const MAJORITY_21 = { ...MEXICO, ageOfMajority: 21 };

const day = (iso: string) => new Date(`${iso}T00:00:00.000Z`);
const id = (n: number) =>
  `aaaaaaaa-0000-4000-8000-${String(n).padStart(12, '0')}`;
const G1 = 'bbbbbbbb-0000-4000-8000-000000000001';
const G2 = 'bbbbbbbb-0000-4000-8000-000000000002';
const G3 = 'bbbbbbbb-0000-4000-8000-000000000003';

type Row = Record<string, any>;

/** Evaluates the subset of Prisma `where` the service uses, over plain rows. */
function matches(row: Row, where: Row): boolean {
  return Object.entries(where).every(([key, cond]) => {
    if (key === 'user') return true; // scan prefilter, covered by the fixtures
    if (key === 'OR') return (cond as Row[]).some((c) => matches(row, c));
    const value = row[key];
    if (cond === null) return value === null || value === undefined;
    if (cond instanceof Date) return value?.getTime() === cond.getTime();
    if (typeof cond === 'object') {
      const c = cond as Row;
      if ('not' in c && c.not === null)
        return value !== null && value !== undefined;
      if ('not' in c)
        return value !== null && value !== undefined && value !== c.not;
      if ('lte' in c && !(value !== null && value <= c.lte)) return false;
      if ('lt' in c && !(value !== null && value < c.lt)) return false;
      if ('gt' in c && !(value !== null && value > c.gt)) return false;
      return true;
    }
    return value === cond;
  });
}

interface World {
  users: Map<string, Row>;
  profiles: Row[];
  guardianships: Row[];
  codes: Row[];
  logins: Row[];
  audits: Row[];
  sends: Array<{ userId: string; source: string; title: string; data: Row }>;
  sectionSends: Array<{ source: string; sectionId: number }>;
}

function profile(userId: string, extra: Row = {}): Row {
  return {
    user_id: userId,
    majority_notice_sent_at: null,
    released_at: null,
    release_deadline_at: null,
    release_source: null,
    release_accepted_at: null,
    release_completed_at: null,
    release_reminder_level: 0,
    frozen_at: null,
    frozen_reason: null,
    purge_after: null,
    purged_at: null,
    ...extra,
  };
}

function person(birthday: string, extra: Row = {}): Row {
  return {
    name: 'Ana',
    email: null,
    birthday: day(birthday),
    country_id: 1,
    active: true,
    account: [{ id: 'acc' }],
    supervised_login: null,
    ...extra,
  };
}

function setup(options: { flagOn?: boolean; dryRunFlag?: boolean } = {}) {
  const world: World = {
    users: new Map(),
    profiles: [],
    guardianships: [],
    codes: [],
    logins: [],
    audits: [],
    sends: [],
    sectionSends: [],
  };
  const hooks = {
    failAuditFor: new Set<string>(),
    failSendFor: new Set<string>(),
    failAllSends: false,
    onBeforeTx: undefined as undefined | ((userId: string) => void),
  };

  const profileApi = {
    findMany: jest.fn(async (args: Row) => {
      let rows = world.profiles.filter((row) => matches(row, args.where));
      rows = rows.sort((a, b) => a.user_id.localeCompare(b.user_id));
      rows = rows.slice(0, args.take ?? rows.length);
      return rows.map((row) => ({
        ...row,
        user: world.users.get(row.user_id) ?? null,
      }));
    }),
    updateMany: jest.fn(async (args: Row) => {
      const rows = world.profiles.filter((row) => matches(row, args.where));
      for (const row of rows) Object.assign(row, args.data);
      return { count: rows.length };
    }),
  };
  const buildTx = () => ({
    $executeRaw: jest.fn().mockResolvedValue(0),
    users: {
      findUnique: jest.fn(
        async (args: Row) => world.users.get(args.where.user_id) ?? null,
      ),
    },
    dependent_profiles: { updateMany: profileApi.updateMany },
    guardianships: {
      findMany: jest.fn(async (args: Row) =>
        world.guardianships.filter((row) => matches(row, args.where)),
      ),
      updateMany: jest.fn(async (args: Row) => {
        const rows = world.guardianships.filter((row) =>
          matches(row, args.where),
        );
        for (const row of rows) Object.assign(row, args.data);
        return { count: rows.length };
      }),
    },
    guardianship_link_codes: {
      updateMany: jest.fn(async (args: Row) => {
        const rows = world.codes.filter((row) => matches(row, args.where));
        for (const row of rows) Object.assign(row, args.data);
        return { count: rows.length };
      }),
    },
    supervised_logins: {
      updateMany: jest.fn(async (args: Row) => {
        const rows = world.logins.filter((row) => matches(row, args.where));
        for (const row of rows) Object.assign(row, args.data);
        return { count: rows.length };
      }),
    },
  });
  const prisma: Row = {
    $executeRaw: jest.fn().mockResolvedValue(0),
    $transaction: jest.fn(async (fn: (tx: Row) => Promise<unknown>) => {
      // Rollback = restore the snapshot taken at BEGIN.
      const snapshot = {
        profiles: structuredClone(world.profiles),
        guardianships: structuredClone(world.guardianships),
        codes: structuredClone(world.codes),
        logins: structuredClone(world.logins),
        audits: structuredClone(world.audits),
      };
      try {
        return await fn(buildTx());
      } catch (error) {
        Object.assign(world, snapshot);
        throw error;
      }
    }),
    dependent_profiles: profileApi,
    guardianships: {
      findMany: jest.fn(async (args: Row) =>
        world.guardianships.filter((row) => matches(row, args.where)),
      ),
    },
  };

  const lock = {
    tryAcquire: jest.fn().mockResolvedValue(true),
    release: jest.fn().mockResolvedValue(undefined),
  };
  const cronLogger = {
    track: jest.fn(async (_n: string, fn: () => Promise<unknown>) => fn()),
    trackSkipped: jest.fn().mockResolvedValue(undefined),
  };
  const policies: Map<number | null, Row> = new Map();
  const countryPolicy = {
    getPolicy: jest.fn(
      async (countryId: number | null) => policies.get(countryId) ?? MEXICO,
    ),
  };
  const notifications = {
    sendToUser: jest.fn(async (dto: Row, _by: string, source: string) => {
      if (hooks.failAllSends || hooks.failSendFor.has(dto.userId)) {
        throw new Error('push down');
      }
      world.sends.push({
        userId: dto.userId,
        source,
        title: dto.title,
        data: dto.data,
      });
      return { success: true };
    }),
    sendToSectionRole: jest.fn(
      async (
        sectionId: number,
        _roles: string[],
        _t: string,
        _b: string,
        _d: Row,
        source: string,
      ) => {
        world.sectionSends.push({ source, sectionId });
      },
    ),
  };
  const security = {
    recipientsOf: jest.fn(async (dependentId: string) => {
      const verified = world.guardianships
        .filter(
          (row) =>
            row.dependent_user_id === dependentId &&
            row.consent_status === 'verified' &&
            row.guardian_user_id &&
            !row.is_custodian,
        )
        .map((row) => row.guardian_user_id as string);
      return verified.length > 0
        ? { firstName: 'Ana', guardianIds: verified }
        : null;
    }),
  };
  const flags = {
    isEnabled: jest.fn(
      (flag: string) => flag === 'majority_release' && options.flagOn !== false,
    ),
    isMajorityReleaseDryRun: jest.fn(() => options.dryRunFlag === true),
  };
  const cache = { bump: jest.fn().mockResolvedValue(undefined) };
  const audit = {
    recordEventOrThrow: jest.fn(async (input: Row) => {
      if (hooks.failAuditFor.has(input.entity_id))
        throw new Error('audit down');
      world.audits.push(input);
    }),
  };
  const deviceRevoker = {
    revokeAllForDependent: jest.fn().mockResolvedValue(0),
    revokeByGuardianship: jest.fn().mockResolvedValue(0),
  };
  const email = { sendMajorityRelease: jest.fn().mockResolvedValue(undefined) };
  // findLiveAssignment is the shared helper: it reads club_role_assignments via
  // the db handed to it; the fake serves custody sections from `world`.
  prisma.club_role_assignments = {
    findMany: jest.fn(async (args: Row) => {
      const rows = (world as any).assignments ?? [];
      return rows.filter((row: Row) => row.user_id === args.where.user_id);
    }),
  };

  const service = new FamilyMajorityReleaseCronService(
    prisma as any,
    lock as any,
    cronLogger as any,
    countryPolicy as any,
    notifications as any,
    security as any,
    flags as any,
    cache as any,
    audit as any,
    deviceRevoker,
    email as any,
  );

  const add = (userId: string, user: Row, prof: Row = {}) => {
    world.users.set(userId, user);
    world.profiles.push(profile(userId, prof));
  };
  const holder = (dependentId: string, extra: Row) => {
    world.guardianships.push({
      guardianship_id: `gs-${world.guardianships.length}`,
      dependent_user_id: dependentId,
      guardian_user_id: null,
      is_custodian: false,
      custodian_club_id: null,
      consent_status: 'verified',
      revoked_at: null,
      revoked_reason: null,
      ...extra,
    });
  };

  return {
    service,
    world,
    prisma,
    lock,
    cronLogger,
    countryPolicy,
    policies,
    notifications,
    security,
    flags,
    cache,
    audit,
    deviceRevoker,
    email,
    hooks,
    add,
    holder,
  };
}

describe('FamilyMajorityReleaseCronService scheduling, flag and locking', () => {
  it('runs daily at 09:30 UTC under the documented job name', () => {
    const metadata = (key: string) =>
      Reflect.getMetadata(
        key,
        FamilyMajorityReleaseCronService.prototype.handleDaily,
      );
    expect(FAMILY_MAJORITY_RELEASE_JOB).toBe('family-majority-release');
    expect(metadata('SCHEDULE_CRON_OPTIONS')).toMatchObject({
      cronTime: '30 9 * * *',
      name: 'family-majority-release',
      timeZone: 'UTC',
    });
  });

  it('flag off: a recorded no-op (no lock, no scan, no writes)', async () => {
    const ctx = setup({ flagOn: false });
    await ctx.service.handleDaily();
    expect(ctx.cronLogger.trackSkipped).toHaveBeenCalledWith(
      'family-majority-release',
      'flag_disabled',
    );
    expect(ctx.lock.tryAcquire).not.toHaveBeenCalled();
    expect(ctx.cronLogger.track).not.toHaveBeenCalled();
    expect(ctx.prisma.dependent_profiles.findMany).not.toHaveBeenCalled();
  });

  it('takes the 23h lock, tracks the run and always releases', async () => {
    const ctx = setup();
    await ctx.service.handleDaily();
    expect(ctx.lock.tryAcquire).toHaveBeenCalledWith(
      'cron:family-majority-release',
      23 * 60 * 60 * 1000,
    );
    expect(ctx.cronLogger.track).toHaveBeenCalledWith(
      'family-majority-release',
      expect.any(Function),
    );
    expect(ctx.lock.release).toHaveBeenCalledWith(
      'cron:family-majority-release',
    );
  });

  it('two instances, one runner: the loser records a skip and touches nothing', async () => {
    const ctx = setup();
    ctx.lock.tryAcquire.mockResolvedValue(false);
    await ctx.service.handleDaily();
    expect(ctx.cronLogger.trackSkipped).toHaveBeenCalledWith(
      'family-majority-release',
      'lock_not_acquired',
    );
    expect(ctx.cronLogger.track).not.toHaveBeenCalled();
    expect(ctx.lock.release).not.toHaveBeenCalled();
  });

  it('a failed item fails the tracked run (cron_run_log / alerts) and still releases the lock', async () => {
    const ctx = setup();
    ctx.add(id(1), person('2008-11-12'), {});
    ctx.hooks.failAuditFor.add(id(1));
    const error = jest
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);
    let tracked: Promise<unknown> | undefined;
    ctx.cronLogger.track.mockImplementation(
      async (_n: string, fn: () => Promise<unknown>) => {
        tracked = fn();
        return tracked;
      },
    );
    await ctx.service.handleDaily();
    await expect(tracked).rejects.toThrow(/1 majority release item/);
    expect(ctx.lock.release).toHaveBeenCalled();
    error.mockRestore();
  });

  it('the dry-run env flag makes the scheduled run write nothing', async () => {
    const ctx = setup({ dryRunFlag: true });
    ctx.add(id(1), person('2008-11-12'));
    const log = jest
      .spyOn(Logger.prototype, 'log')
      .mockImplementation(() => undefined);
    await ctx.service.handleDaily();
    expect(ctx.prisma.$transaction).not.toHaveBeenCalled();
    expect(ctx.world.profiles[0].released_at).toBeNull();
    log.mockRestore();
  });
});

describe('release (step 2)', () => {
  it('revokes EVERY guardianship (guardians, pending, club custody) with reason released, creating no custody row and promoting nobody', async () => {
    const ctx = setup();
    ctx.add(id(1), person('2008-11-12'));
    ctx.holder(id(1), { guardian_user_id: G1, is_primary: true });
    ctx.holder(id(1), { guardian_user_id: G2, consent_status: 'pending' });
    ctx.holder(id(1), { is_custodian: true, custodian_club_id: 7 });
    ctx.world.codes.push(
      {
        dependent_user_id: id(1),
        purpose: 'second_guardian',
        consumed_at: null,
        revoked_at: null,
      },
      {
        dependent_user_id: id(1),
        purpose: 'adult_claim',
        consumed_at: null,
        revoked_at: null,
      },
    );
    ctx.world.logins.push({
      user_id: id(1),
      pending_since: NOW,
      pending_reminder_level: 2,
    });

    const { summary } = await ctx.service.run(NOW);

    expect(summary).toMatchObject({ released: 1, failed: 0 });
    expect(ctx.world.guardianships).toHaveLength(3); // no custody row added
    for (const row of ctx.world.guardianships) {
      expect(row).toMatchObject({
        consent_status: 'revoked',
        revoked_reason: 'released',
        revoked_at: NOW,
      });
    }
    expect(ctx.world.guardianships.filter((r) => r.is_primary)).toHaveLength(1);
    const [second, claim] = ctx.world.codes;
    expect(second.revoked_at).toEqual(NOW);
    expect(claim.revoked_at).toBeNull(); // adult_claim survives
    expect(ctx.world.logins[0]).toMatchObject({
      pending_since: null,
      pending_reminder_level: 0,
    });
    expect(ctx.deviceRevoker.revokeAllForDependent).toHaveBeenCalledWith(
      expect.anything(),
      id(1),
      'majority',
    );
    expect(ctx.world.profiles[0]).toMatchObject({
      released_at: NOW,
      release_deadline_at: new Date(NOW.getTime() + 30 * DAY_MS),
      release_source: 'cron',
      release_reminder_level: 0,
    });
    expect(ctx.world.audits[0]).toMatchObject({
      action: 'family.majority.released',
      actor_kind: 'system',
      entity_id: id(1),
    });
    expect(ctx.cache.bump).toHaveBeenCalledWith(id(1));
  });

  it('bumps AFTER the commit and tells the person ("now independent"), not the former guardians', async () => {
    const ctx = setup();
    ctx.add(id(1), person('2008-11-12'));
    ctx.holder(id(1), { guardian_user_id: G1 });

    await ctx.service.run(NOW);

    expect(ctx.world.sends.map((s) => [s.userId, s.source])).toEqual([
      [id(1), MAJORITY_RELEASED_SOURCE],
    ]);
    expect(ctx.world.sends[0].data.type).toBe('majority_released');
  });

  it('a person already completed under the lazy gate is released silently (no notice)', async () => {
    const ctx = setup();
    ctx.add(id(1), person('2008-11-12'), {
      release_accepted_at: NOW,
      release_completed_at: NOW,
    });
    ctx.holder(id(1), { guardian_user_id: G1 });
    await ctx.service.run(NOW);
    expect(ctx.world.guardianships[0].revoked_reason).toBe('released');
    expect(ctx.world.sends).toHaveLength(0);
    expect(ctx.world.profiles[0].release_completed_at).toEqual(NOW);
  });

  it('account-less person: handover to the just-revoked guardians only (guardian pending too), nothing to the person', async () => {
    const ctx = setup();
    ctx.add(id(1), person('2008-11-12', { account: [] }));
    ctx.holder(id(1), { guardian_user_id: G1 });
    ctx.holder(id(1), { guardian_user_id: G2, consent_status: 'pending' });

    await ctx.service.run(NOW);

    expect(ctx.world.sends.map((s) => [s.userId, s.source]).sort()).toEqual(
      [
        [G1, MAJORITY_HANDOVER_SOURCE],
        [G2, MAJORITY_HANDOVER_SOURCE],
      ].sort(),
    );
    expect(
      ctx.world.sends.every((s) => s.data.type === 'majority_handover'),
    ).toBe(true);
  });

  it('custody-only account-less person: the custodian section directors get the handover', async () => {
    const ctx = setup();
    ctx.add(id(1), person('2008-11-12', { account: [] }));
    ctx.holder(id(1), { is_custodian: true, custodian_club_id: 7 });
    (ctx.world as any).assignments = [
      {
        assignment_id: 'a1',
        user_id: id(1),
        status: 'active',
        club_section_id: 55,
        club_sections: { main_club_id: 7 },
        created_at: NOW,
      },
    ];

    await ctx.service.run(NOW);

    expect(ctx.world.sectionSends).toEqual([
      { source: MAJORITY_HANDOVER_SOURCE, sectionId: 55 },
    ]);
    expect(ctx.world.sends).toHaveLength(0);
  });

  it('notification failure never blocks the release', async () => {
    const ctx = setup();
    ctx.add(id(1), person('2008-11-12'));
    ctx.holder(id(1), { guardian_user_id: G1 });
    ctx.hooks.failAllSends = true;
    const error = jest
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);

    const { summary } = await ctx.service.run(NOW);

    expect(summary.released).toBe(1);
    expect(summary.failed).toBe(0);
    expect(ctx.world.guardianships[0].revoked_reason).toBe('released');
    error.mockRestore();
  });

  it('a transaction failure rolls everything back: no revoke, no claim, no bump', async () => {
    const ctx = setup();
    ctx.add(id(1), person('2008-11-12'));
    ctx.holder(id(1), { guardian_user_id: G1 });
    ctx.hooks.failAuditFor.add(id(1));
    const error = jest
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);

    const { summary } = await ctx.service.run(NOW);

    expect(summary).toMatchObject({ released: 0, failed: 1 });
    expect(ctx.world.guardianships[0]).toMatchObject({
      consent_status: 'verified',
      revoked_reason: null,
    });
    expect(ctx.world.profiles[0].released_at).toBeNull();
    expect(ctx.cache.bump).not.toHaveBeenCalled();
    error.mockRestore();
  });

  it('two concurrent runs: exactly one winner; a second run has all counters at 0', async () => {
    const ctx = setup();
    ctx.add(id(1), person('2008-11-12'));
    ctx.holder(id(1), { guardian_user_id: G1 });

    const [a, b] = await Promise.all([
      ctx.service.run(NOW),
      ctx.service.run(NOW),
    ]);
    expect(a.summary.released + b.summary.released).toBe(1);
    expect(
      ctx.world.audits.filter((x) => x.action === 'family.majority.released'),
    ).toHaveLength(1);

    const again = await ctx.service.run(NOW);
    expect(again.summary).toEqual({
      noticed: 0,
      released: 0,
      reminded: 0,
      frozen: 0,
      skippedNoRecipient: 0,
      skippedNoBirthday: 0,
      failed: 0,
    });
  });

  it('partial failure: 97 released and 3 failed, the run keeps going', async () => {
    const ctx = setup();
    for (let n = 1; n <= 100; n += 1) {
      ctx.add(id(n), person('2008-11-12'));
      ctx.holder(id(n), { guardian_user_id: G1 });
    }
    for (const n of [10, 50, 99]) ctx.hooks.failAuditFor.add(id(n));
    const error = jest
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);

    const { summary } = await ctx.service.run(NOW);

    expect(summary).toMatchObject({ released: 97, failed: 3 });
    error.mockRestore();
  });

  describe('age math', () => {
    it('Feb-29 birth is released on Mar-1 of a non-leap year, not on Feb-28', async () => {
      const ctx = setup();
      ctx.add(id(1), person('2008-02-29'));
      const feb28 = new Date('2026-02-28T09:30:00.000Z');
      const mar1 = new Date('2026-03-01T09:30:00.000Z');

      expect((await ctx.service.run(feb28)).summary.released).toBe(0);
      const result = await ctx.service.run(mar1);
      expect(result.summary.released).toBe(1);
      expect(ctx.world.profiles[0].release_source).toBe('cron');
    });

    it('a country with an age of majority of 21 does not release a 19 year old; 18 does', async () => {
      const ctx = setup();
      ctx.policies.set(2, MAJORITY_21);
      ctx.add(id(1), person('2007-01-01', { country_id: 2 })); // 19
      ctx.add(id(2), person('2007-01-01', { country_id: 1 })); // 19
      const { summary } = await ctx.service.run(NOW);
      expect(summary.released).toBe(1);
      expect(
        ctx.world.profiles.find((p) => p.user_id === id(1))!.released_at,
      ).toBeNull();
      expect(
        ctx.world.profiles.find((p) => p.user_id === id(2))!.released_at,
      ).toEqual(NOW);
    });

    it('a majority older than a day is the catch-up path: released_at = now, deadline now+30d, audited as backfill', async () => {
      const ctx = setup();
      ctx.add(id(1), person('2005-03-10'));
      await ctx.service.run(NOW);
      expect(ctx.world.profiles[0]).toMatchObject({
        release_source: 'catchup',
        released_at: NOW,
        release_deadline_at: new Date(NOW.getTime() + 30 * DAY_MS),
      });
      expect(ctx.world.audits[0].action).toBe(
        'family.majority.backfill_released',
      );
    });

    it('users without a birthday or inactive are never processed', async () => {
      const ctx = setup();
      ctx.add(id(1), person('2008-11-12', { birthday: null }));
      ctx.add(id(2), person('2008-11-12', { active: false }));
      const { summary } = await ctx.service.run(NOW);
      expect(summary.released).toBe(0);
      expect(summary.skippedNoBirthday).toBe(2);
    });

    it('a corrected birthday wins under the lock (re-check)', async () => {
      const ctx = setup();
      ctx.add(id(1), person('2008-11-12'));
      const original =
        ctx.prisma.dependent_profiles.findMany.getMockImplementation()!;
      ctx.prisma.dependent_profiles.findMany.mockImplementation(
        async (args: Row) => {
          const rows = await original(args);
          // The guardian corrects the birthday right after the scan.
          ctx.world.users.set(id(1), person('2012-01-01'));
          return rows;
        },
      );
      const { summary } = await ctx.service.run(NOW);
      expect(summary.released).toBe(0);
      expect(ctx.world.profiles[0].released_at).toBeNull();
    });
  });

  it('caches the country policy once per country per run', async () => {
    const ctx = setup();
    for (let n = 1; n <= 5; n += 1) ctx.add(id(n), person('2008-11-12'));
    await ctx.service.run(NOW);
    expect(ctx.countryPolicy.getPolicy).toHaveBeenCalledTimes(1);
  });

  it('step 0 re-asserts the tracking invariant (anti-join insert)', async () => {
    const ctx = setup();
    await ctx.service.run(NOW);
    expect(ctx.prisma.$executeRaw).toHaveBeenCalledTimes(1);
  });
});

describe('dry run', () => {
  it('lists who would be noticed / released / reminded / frozen and writes or sends nothing', async () => {
    const ctx = setup();
    ctx.add(id(1), person('2008-11-12'), {}); // release (cron)
    ctx.add(id(2), person('2005-03-10'), {}); // release (catchup)
    ctx.add(id(3), person('2008-12-05'), {}); // notice
    ctx.add(id(4), person('2000-01-01'), {
      released_at: new Date(NOW.getTime() - 24 * DAY_MS),
      release_deadline_at: new Date(NOW.getTime() + 6 * DAY_MS),
    }); // reminder
    ctx.add(id(5), person('2000-01-01'), {
      released_at: new Date(NOW.getTime() - 31 * DAY_MS),
      release_deadline_at: new Date(NOW.getTime() - DAY_MS),
    }); // freeze
    const before = structuredClone(ctx.world.profiles);

    const { items, summary } = await ctx.service.run(NOW, { dryRun: true });

    expect(items.map((i) => [i.user_id, i.step, i.source]).sort()).toEqual(
      [
        [id(1), 'release', 'cron'],
        [id(2), 'release', 'catchup'],
        [id(3), 'notice', undefined],
        [id(4), 'reminder', undefined],
        [id(5), 'freeze', undefined],
      ].sort(),
    );
    expect(items.find((i) => i.user_id === id(1))!.majorityDate).toBe(
      '2026-11-12',
    );
    expect(JSON.stringify(items)).not.toMatch(/Ana|@/); // uuid only
    expect(ctx.world.profiles).toEqual(before);
    expect(ctx.prisma.$transaction).not.toHaveBeenCalled();
    expect(ctx.prisma.$executeRaw).not.toHaveBeenCalled();
    expect(ctx.notifications.sendToUser).not.toHaveBeenCalled();
    expect(ctx.cache.bump).not.toHaveBeenCalled();
    expect(summary.released).toBe(0);
  });

  it('only_dependent_id restricts every step to one person', async () => {
    const ctx = setup();
    ctx.add(id(1), person('2008-11-12'));
    ctx.add(id(2), person('2008-11-12'));
    const { items } = await ctx.service.run(NOW, {
      dryRun: true,
      onlyDependentId: id(2),
    });
    expect(items.map((i) => i.user_id)).toEqual([id(2)]);
  });
});

describe('notice (step 1, T-30)', () => {
  it('tells the person, the verified guardians and claims majority_notice_sent_at once', async () => {
    const ctx = setup();
    ctx.add(id(1), person('2008-12-05')); // majority 2026-12-05: 23 days away
    ctx.holder(id(1), { guardian_user_id: G1 });
    ctx.holder(id(1), { guardian_user_id: G2 });

    const first = await ctx.service.run(NOW);
    expect(first.summary.noticed).toBe(1);
    expect(ctx.world.profiles[0].majority_notice_sent_at).toEqual(NOW);
    expect(ctx.world.sends.map((s) => [s.userId, s.source]).sort()).toEqual(
      [
        [id(1), MAJORITY_NOTICE_SOURCE],
        [G1, MAJORITY_NOTICE_SOURCE],
        [G2, MAJORITY_NOTICE_SOURCE],
      ].sort(),
    );
    // Nobody is released yet: guardianships untouched.
    expect(
      ctx.world.guardianships.every((g) => g.revoked_reason === null),
    ).toBe(true);

    const second = await ctx.service.run(NOW);
    expect(second.summary.noticed).toBe(0);
    expect(ctx.world.sends).toHaveLength(3);
  });

  it('is not sent before the 30-day window opens', async () => {
    const ctx = setup();
    ctx.add(id(1), person('2009-01-20')); // 69 days away
    const { summary } = await ctx.service.run(NOW);
    expect(summary.noticed).toBe(0);
  });

  it('a total send failure gives the claim back (tomorrow retries) and counts as failed', async () => {
    const ctx = setup();
    ctx.add(id(1), person('2008-12-05'));
    ctx.hooks.failAllSends = true;
    const error = jest
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);

    const { summary } = await ctx.service.run(NOW);

    expect(summary).toMatchObject({ noticed: 0, failed: 1 });
    expect(ctx.world.profiles[0].majority_notice_sent_at).toBeNull();
    error.mockRestore();
  });

  it('custody-only minor without an account: the section directors are told', async () => {
    const ctx = setup();
    ctx.add(id(1), person('2008-12-05', { account: [] }));
    ctx.holder(id(1), { is_custodian: true, custodian_club_id: 7 });
    (ctx.world as any).assignments = [
      {
        assignment_id: 'a1',
        user_id: id(1),
        status: 'active',
        club_section_id: 55,
        club_sections: { main_club_id: 7 },
        created_at: NOW,
      },
    ];
    const { summary } = await ctx.service.run(NOW);
    expect(summary.noticed).toBe(1);
    expect(ctx.world.sectionSends).toEqual([
      { source: MAJORITY_NOTICE_SOURCE, sectionId: 55 },
    ]);
  });

  it('nobody to tell: counted as skippedNoRecipient, the claim is never taken', async () => {
    const ctx = setup();
    ctx.add(id(1), person('2008-12-05', { account: [] }));
    const { summary } = await ctx.service.run(NOW);
    expect(summary).toMatchObject({ noticed: 0, skippedNoRecipient: 1 });
    expect(ctx.world.profiles[0].majority_notice_sent_at).toBeNull();
  });
});

describe('reminders (step 3, ruling R2: deadline-7d and deadline-1d)', () => {
  const released = (daysAgo: number, extra: Row = {}) => ({
    released_at: new Date(NOW.getTime() - daysAgo * DAY_MS),
    release_deadline_at: new Date(NOW.getTime() + (30 - daysAgo) * DAY_MS),
    ...extra,
  });

  it('level 1 at >= 23 days, level 2 at >= 29 days, each once', async () => {
    const ctx = setup();
    ctx.add(id(1), person('2000-01-01'), released(22));
    ctx.add(id(2), person('2000-01-01'), released(23));
    ctx.add(
      id(3),
      person('2000-01-01'),
      released(29, { release_reminder_level: 1 }),
    );

    const first = await ctx.service.run(NOW);

    expect(first.summary.reminded).toBe(2);
    const byId = (n: number) =>
      ctx.world.profiles.find((p) => p.user_id === id(n))!;
    expect(byId(1).release_reminder_level).toBe(0);
    expect(byId(2).release_reminder_level).toBe(1);
    expect(byId(3).release_reminder_level).toBe(2);
    expect(
      ctx.world.sends.every((s) => s.source === MAJORITY_REMINDER_SOURCE),
    ).toBe(true);
    expect(
      ctx.world.sends.find((s) => s.userId === id(3))!.data.days_left,
    ).toBe('1');

    expect((await ctx.service.run(NOW)).summary.reminded).toBe(0);
  });

  it('a total failure gives the level back', async () => {
    const ctx = setup();
    ctx.add(id(1), person('2000-01-01'), released(24));
    ctx.hooks.failAllSends = true;
    const error = jest
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);
    const { summary } = await ctx.service.run(NOW);
    expect(summary).toMatchObject({ reminded: 0, failed: 1 });
    expect(ctx.world.profiles[0].release_reminder_level).toBe(0);
    error.mockRestore();
  });

  it('account-less person: the former guardians are reminded', async () => {
    const ctx = setup();
    ctx.add(id(1), person('2000-01-01', { account: [] }), released(24));
    ctx.holder(id(1), {
      guardian_user_id: G3,
      consent_status: 'revoked',
      revoked_reason: 'released',
      revoked_at: NOW,
    });
    await ctx.service.run(NOW);
    expect(ctx.world.sends.map((s) => s.userId)).toEqual([G3]);
  });

  it('a completed release is never reminded', async () => {
    const ctx = setup();
    ctx.add(
      id(1),
      person('2000-01-01'),
      released(25, { release_accepted_at: NOW, release_completed_at: NOW }),
    );
    expect((await ctx.service.run(NOW)).summary.reminded).toBe(0);
  });
});

describe('freeze (step 4, rulings R3 and R6)', () => {
  const expired = (extra: Row = {}) => ({
    released_at: new Date(NOW.getTime() - 31 * DAY_MS),
    release_deadline_at: new Date(NOW.getTime() - DAY_MS),
    release_reminder_level: 2,
    ...extra,
  });

  it('freezes after the deadline with frozen_reason majority_release and NEVER a purge_after', async () => {
    const ctx = setup();
    ctx.add(id(1), person('2000-01-01'), expired());
    ctx.world.codes.push({
      dependent_user_id: id(1),
      purpose: 'adult_claim',
      consumed_at: null,
      revoked_at: null,
    });

    const { summary } = await ctx.service.run(NOW);

    expect(summary.frozen).toBe(1);
    expect(ctx.world.profiles[0]).toMatchObject({
      frozen_at: NOW,
      frozen_reason: 'majority_release',
      purge_after: null,
    });
    const data = ctx.prisma.dependent_profiles.updateMany.mock.calls
      .map(([args]: [Row]) => args.data)
      .find((d: Row) => d.frozen_at);
    expect(data).not.toHaveProperty('purge_after');
    // adult_claim codes survive the freeze (R6: claim allowed while frozen).
    expect(ctx.world.codes[0].revoked_at).toBeNull();
    expect(ctx.world.audits[0].action).toBe('family.majority.frozen');
    expect(ctx.cache.bump).toHaveBeenCalledWith(id(1));
  });

  it('only the PERSON is told; former guardians never are (R3)', async () => {
    const ctx = setup();
    ctx.add(id(1), person('2000-01-01'), expired());
    ctx.holder(id(1), {
      guardian_user_id: G1,
      consent_status: 'revoked',
      revoked_reason: 'released',
      revoked_at: NOW,
    });
    await ctx.service.run(NOW);
    expect(ctx.world.sends.map((s) => [s.userId, s.source])).toEqual([
      [id(1), MAJORITY_FROZEN_SOURCE],
    ]);
  });

  it('a person who completed before the deadline is never frozen', async () => {
    const ctx = setup();
    ctx.add(
      id(1),
      person('2000-01-01'),
      expired({ release_accepted_at: NOW, release_completed_at: NOW }),
    );
    expect((await ctx.service.run(NOW)).summary.frozen).toBe(0);
    expect(ctx.world.profiles[0].frozen_at).toBeNull();
  });

  it('an accept that races the freeze wins (re-check inside the transaction)', async () => {
    const ctx = setup();
    ctx.add(id(1), person('2000-01-01'), expired());
    const original =
      ctx.prisma.dependent_profiles.findMany.getMockImplementation()!;
    ctx.prisma.dependent_profiles.findMany.mockImplementation(
      async (args: Row) => {
        const rows = await original(args);
        // The person accepts right after the scan, before the freeze transaction.
        Object.assign(ctx.world.profiles[0], {
          release_accepted_at: NOW,
          release_completed_at: NOW,
        });
        return rows;
      },
    );
    const { summary } = await ctx.service.run(NOW);
    expect(summary.frozen).toBe(0);
    expect(ctx.world.profiles[0].frozen_at).toBeNull();
    expect(ctx.world.audits).toHaveLength(0);
  });

  it('a frozen row is skipped by every later run (no second freeze, no purge scheduling)', async () => {
    const ctx = setup();
    ctx.add(id(1), person('2000-01-01'), expired());
    await ctx.service.run(NOW);
    const again = await ctx.service.run(new Date(NOW.getTime() + 200 * DAY_MS));
    expect(again.summary.frozen).toBe(0);
    expect(ctx.world.profiles[0].purge_after).toBeNull();
    expect(ctx.world.profiles[0].purged_at).toBeNull();
  });
});

describe('FamilyMajorityReleaseCronService email channel (4b)', () => {
  it('notice: mails ONLY the person who has an address, once, after the claim', async () => {
    const ctx = setup();
    ctx.add(id(1), person('2008-12-05', { email: 'ana@example.com' }));
    ctx.holder(id(1), { guardian_user_id: G1 });

    await ctx.service.run(NOW);
    await ctx.service.run(NOW);

    expect(ctx.email.sendMajorityRelease).toHaveBeenCalledTimes(1);
    expect(ctx.email.sendMajorityRelease).toHaveBeenCalledWith({
      to: 'ana@example.com',
      kind: 'notice',
      majorityDate: '2026-12-05',
    });
  });

  it('a handle teen (no email) gets push/inbox only', async () => {
    const ctx = setup();
    ctx.add(id(1), person('2008-12-05'));
    ctx.holder(id(1), { guardian_user_id: G1 });

    await ctx.service.run(NOW);

    expect(ctx.email.sendMajorityRelease).not.toHaveBeenCalled();
  });

  it('released: the person is mailed, the former guardians never are', async () => {
    const ctx = setup();
    ctx.add(id(1), person('2008-11-12', { email: 'ana@example.com' }));
    ctx.holder(id(1), { guardian_user_id: G1 });

    await ctx.service.run(NOW);

    expect(ctx.email.sendMajorityRelease).toHaveBeenCalledTimes(1);
    expect(ctx.email.sendMajorityRelease.mock.calls[0][0]).toMatchObject({
      to: 'ana@example.com',
      kind: 'released',
    });
  });

  it('reminder and freeze mail the person; an email failure never fails the run', async () => {
    const ctx = setup();
    ctx.email.sendMajorityRelease.mockRejectedValue(new Error('queue down'));
    ctx.add(id(1), person('2000-01-01', { email: 'ana@example.com' }), {
      released_at: new Date(NOW.getTime() - 23 * DAY_MS),
      release_deadline_at: new Date(NOW.getTime() + 7 * DAY_MS),
    });
    ctx.add(id(2), person('2000-01-01', { email: 'bo@example.com' }), {
      released_at: new Date(NOW.getTime() - 40 * DAY_MS),
      release_deadline_at: new Date(NOW.getTime() - 10 * DAY_MS),
    });

    const { summary } = await ctx.service.run(NOW);

    expect(summary.failed).toBe(0);
    expect(summary.reminded).toBe(1);
    expect(summary.frozen).toBe(1);
    expect(
      ctx.email.sendMajorityRelease.mock.calls
        .map((c: any[]) => c[0].kind)
        .sort(),
    ).toEqual(['frozen', 'reminder']);
  });

  it('dry run sends no mail', async () => {
    const ctx = setup();
    ctx.add(id(1), person('2008-12-05', { email: 'ana@example.com' }));
    await ctx.service.run(NOW, { dryRun: true });
    expect(ctx.email.sendMajorityRelease).not.toHaveBeenCalled();
  });
});
