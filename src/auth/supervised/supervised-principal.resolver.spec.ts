import { Logger } from '@nestjs/common';
import { ErrorCode } from '../../common/errors/error-codes';
import {
  DEFAULT_COUNTRY_AGE_POLICY,
  type CountryAgePolicyService,
} from '../../common/age/country-age-policy.service';
import {
  SUPERVISED_STATE_MEMO,
  TEEN_PENDING_SCOPES,
  TEEN_SCOPES,
} from '../acting-for/auth-principal';
import { ActingForCache } from '../acting-for/acting-for.cache';
import { SupervisedPrincipalCache } from './supervised-principal.cache';
import {
  scopesForSupervision,
  SupervisedPrincipalResolver,
} from './supervised-principal.resolver';

const NOW = new Date('2026-10-20T15:00:00.000Z');

function fakeCacheManager() {
  const store = new Map<string, unknown>();
  return {
    store,
    get: jest.fn(async (key: string) => store.get(key)),
    set: jest.fn(async (key: string, value: unknown) => {
      store.set(key, value);
    }),
  };
}

interface UserRow {
  birthday: Date | null;
  country_id: number | null;
  supervised_login: { disabled_at: Date | null } | null;
  dependent_profile: { frozen_at: Date | null; purged_at: Date | null } | null;
  guardianships_as_dependent: Array<{ guardianship_id: string }>;
}

const date = (value: string) => new Date(`${value}T00:00:00.000Z`);

const user = (overrides: Partial<UserRow> = {}): UserRow => ({
  birthday: date('2011-06-01'), // 15
  country_id: null,
  supervised_login: null,
  dependent_profile: null,
  guardianships_as_dependent: [],
  ...overrides,
});

describe('SupervisedPrincipalResolver', () => {
  let manager: ReturnType<typeof fakeCacheManager>;
  let prisma: {
    users: { findUnique: jest.Mock };
    session: { findFirst: jest.Mock };
  };
  let policy: { getPolicy: jest.Mock };
  let resolver: SupervisedPrincipalResolver;
  let epochs: ActingForCache;

  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(NOW);
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    manager = fakeCacheManager();
    prisma = {
      users: { findUnique: jest.fn().mockResolvedValue(user()) },
      session: { findFirst: jest.fn().mockResolvedValue({ id: 'sid-1' }) },
    };
    policy = {
      getPolicy: jest.fn().mockResolvedValue({ ...DEFAULT_COUNTRY_AGE_POLICY }),
    };
    epochs = new ActingForCache(manager as any);
    resolver = new SupervisedPrincipalResolver(
      prisma as any,
      new SupervisedPrincipalCache(manager as any, epochs),
      policy as unknown as CountryAgePolicyService,
    );
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  describe('age boundaries', () => {
    it.each([
      ['an adult of 26', '2000-01-01', 'adult'],
      ['exactly 18 today', '2008-10-20', 'adult'],
      ['18 tomorrow (still 17)', '2008-10-21', 'supervised'],
      ['17', '2009-10-21', 'supervised'],
      ['13 exactly', '2013-10-20', 'supervised'],
      ['12 (account holder below the minimum age)', '2013-10-21', 'supervised'],
    ])('%s', async (_label, birthday, expected) => {
      prisma.users.findUnique.mockResolvedValue(
        user({ birthday: date(birthday) }),
      );
      const result = await resolver.resolve('u1');
      expect(result.state).toBe(expected);
    });

    it('treats a NULL birthday as an adult (kind stays user)', async () => {
      prisma.users.findUnique.mockResolvedValue(user({ birthday: null }));
      expect(await resolver.resolve('u1')).toEqual({ state: 'adult' });
    });

    it('treats a missing user row as an adult (never breaks unknown subjects)', async () => {
      prisma.users.findUnique.mockResolvedValue(null);
      expect(await resolver.resolve('u1')).toEqual({ state: 'adult' });
    });

    it('follows the country policy (majority 16)', async () => {
      policy.getPolicy.mockResolvedValue({
        minSelfLoginAge: 13,
        ageOfMajority: 16,
        timeZone: 'America/Mexico_City',
      });
      prisma.users.findUnique.mockResolvedValue(
        user({ birthday: date('2010-06-01'), country_id: 7 }), // 16
      );
      expect(await resolver.resolve('u1')).toEqual({ state: 'adult' });
      expect(policy.getPolicy).toHaveBeenCalledWith(7);
    });

    it('turns 18 at the country midnight, not at UTC midnight', async () => {
      // 2026-10-21T04:00Z is still 2026-10-20 22:00 in Mexico City.
      jest.setSystemTime(new Date('2026-10-21T04:00:00.000Z'));
      prisma.users.findUnique.mockResolvedValue(
        user({ birthday: date('2008-10-21') }),
      );
      expect((await resolver.resolve('tz-1')).state).toBe('supervised');
      // After local midnight (06:00Z) the same birthday is 18.
      jest.setSystemTime(new Date('2026-10-21T07:00:00.000Z'));
      expect((await resolver.resolve('tz-2')).state).toBe('adult');
    });
  });

  describe('supervision', () => {
    it('is pending_guardian with no guardianship at all', async () => {
      expect(await resolver.resolve('u1')).toEqual({
        state: 'supervised',
        supervision: 'pending_guardian',
      });
    });

    it('queries only VERIFIED, non-test, non-revoked, NON-custodian rows (custody and pending links stay pending)', async () => {
      await resolver.resolve('u1');
      const args = prisma.users.findUnique.mock.calls[0][0];
      expect(args.select.guardianships_as_dependent).toMatchObject({
        where: {
          consent_status: 'verified',
          is_test_data: false,
          is_custodian: false,
          revoked_at: null,
        },
        take: 1,
      });
    });

    it('is active with a verified non-custodian guardianship', async () => {
      prisma.users.findUnique.mockResolvedValue(
        user({ guardianships_as_dependent: [{ guardianship_id: 'g1' }] }),
      );
      expect(await resolver.resolve('u1')).toEqual({
        state: 'supervised',
        supervision: 'active',
      });
    });

    it('maps the supervision status to its scope set', () => {
      expect(scopesForSupervision('active')).toBe(TEEN_SCOPES);
      expect(scopesForSupervision('pending_guardian')).toBe(
        TEEN_PENDING_SCOPES,
      );
    });
  });

  describe('blocked', () => {
    it('is blocked:frozen for a frozen dependent profile', async () => {
      prisma.users.findUnique.mockResolvedValue(
        user({ dependent_profile: { frozen_at: NOW, purged_at: null } }),
      );
      expect(await resolver.resolve('u1')).toEqual({
        state: 'blocked',
        cause: 'frozen',
      });
    });

    it('is blocked:frozen for a purged profile', async () => {
      prisma.users.findUnique.mockResolvedValue(
        user({ dependent_profile: { frozen_at: null, purged_at: NOW } }),
      );
      expect(await resolver.resolve('u1')).toMatchObject({ cause: 'frozen' });
    });

    it('is blocked:login_disabled when the supervised login was disabled', async () => {
      prisma.users.findUnique.mockResolvedValue(
        user({ supervised_login: { disabled_at: NOW } }),
      );
      expect(await resolver.resolve('u1')).toEqual({
        state: 'blocked',
        cause: 'login_disabled',
      });
    });

    it('a disabled login of someone who reached majority keeps working (adult wins)', async () => {
      prisma.users.findUnique.mockResolvedValue(
        user({
          birthday: date('2000-01-01'),
          supervised_login: { disabled_at: NOW },
        }),
      );
      expect(await resolver.resolve('u1')).toEqual({ state: 'adult' });
    });
  });

  describe('cache', () => {
    it('serves the second call from the cache', async () => {
      await resolver.resolve('u1');
      await resolver.resolve('u1');
      expect(prisma.users.findUnique).toHaveBeenCalledTimes(1);
    });

    it('mints an epoch on the first call and reads no payload under it', async () => {
      await resolver.resolve('u1');
      expect(manager.store.has('acting:epoch:u1')).toBe(true);
    });

    it('an epoch bump defeats the cached state', async () => {
      await resolver.resolve('u1');
      await epochs.bump('u1');
      prisma.users.findUnique.mockResolvedValue(
        user({ supervised_login: { disabled_at: NOW } }),
      );
      expect(await resolver.resolve('u1')).toEqual({
        state: 'blocked',
        cause: 'login_disabled',
      });
      expect(prisma.users.findUnique).toHaveBeenCalledTimes(2);
    });

    it('falls back to the database when Redis is down', async () => {
      manager.get.mockRejectedValue(new Error('redis down'));
      manager.set.mockRejectedValue(new Error('redis down'));
      expect(await resolver.resolve('u1')).toEqual({
        state: 'supervised',
        supervision: 'pending_guardian',
      });
      expect(prisma.users.findUnique).toHaveBeenCalledTimes(1);
    });

    it('answers 503 AUTH_REVOCATION_CHECK_UNAVAILABLE when the database is down (never fails open)', async () => {
      prisma.users.findUnique.mockRejectedValue(new Error('db down'));
      await expect(resolver.resolve('u1')).rejects.toMatchObject({
        code: ErrorCode.AUTH_REVOCATION_CHECK_UNAVAILABLE,
        status: 503,
      });
    });

    it('an epoch lost to a Redis flush is a miss (fresh DB read)', async () => {
      await resolver.resolve('u1');
      manager.store.clear();
      prisma.users.findUnique.mockResolvedValue(
        user({ guardianships_as_dependent: [{ guardianship_id: 'g1' }] }),
      );
      expect(await resolver.resolve('u1')).toMatchObject({
        supervision: 'active',
      });
    });

    it('caps the cached entry at the next local midnight', async () => {
      // 05:59:30Z = 23:59:30 in Mexico City: a supervised entry would live 60s but only 30s remain.
      jest.setSystemTime(new Date('2026-10-21T05:59:30.000Z'));
      await resolver.resolve('u1');
      expect(manager.set).toHaveBeenCalledWith(
        expect.stringMatching(/^supv:v1:u1:/),
        { state: 'supervised', supervision: 'pending_guardian' },
        30_000,
      );
    });
  });

  describe('request memo', () => {
    it('reuses the first lookup on a guard re-run of the same request', async () => {
      const req: Record<symbol, unknown> = {};
      const first = await resolver.resolveForRequest(req, 'u1');
      const second = await resolver.resolveForRequest(req, 'u1');
      expect(second).toBe(first);
      expect(prisma.users.findUnique).toHaveBeenCalledTimes(1);
      expect(req[SUPERVISED_STATE_MEMO]).toBeDefined();
    });

    it('does not reuse the memo for another subject', async () => {
      const req = {};
      await resolver.resolveForRequest(req, 'u1');
      await resolver.resolveForRequest(req, 'u2');
      expect(prisma.users.findUnique).toHaveBeenCalledTimes(2);
    });
  });

  describe('isSessionActive', () => {
    it('is true when the sid session exists and caches it', async () => {
      expect(await resolver.isSessionActive('u1', 'sid-1')).toBe(true);
      expect(await resolver.isSessionActive('u1', 'sid-1')).toBe(true);
      expect(prisma.session.findFirst).toHaveBeenCalledTimes(1);
      expect(prisma.session.findFirst.mock.calls[0][0].where).toMatchObject({
        id: 'sid-1',
        userId: 'u1',
      });
    });

    it('is false when the session was deleted', async () => {
      prisma.session.findFirst.mockResolvedValue(null);
      expect(await resolver.isSessionActive('u1', 'sid-1')).toBe(false);
    });

    it('a bumped epoch re-reads the session (disable/reset cut inside the 8h JWT)', async () => {
      expect(await resolver.isSessionActive('u1', 'sid-1')).toBe(true);
      prisma.session.findFirst.mockResolvedValue(null);
      await epochs.bump('u1');
      expect(await resolver.isSessionActive('u1', 'sid-1')).toBe(false);
    });

    it('without a sid it checks that the user has any live session', async () => {
      await resolver.isSessionActive('u1', null);
      expect(prisma.session.findFirst.mock.calls[0][0].where).toEqual({
        userId: 'u1',
        expiresAt: { gt: expect.any(Date) },
      });
    });

    it('falls back to the DB when Redis is down', async () => {
      manager.get.mockRejectedValue(new Error('redis down'));
      manager.set.mockRejectedValue(new Error('redis down'));
      expect(await resolver.isSessionActive('u1', 'sid-1')).toBe(true);
    });

    it('answers 503 when the database is down', async () => {
      prisma.session.findFirst.mockRejectedValue(new Error('db down'));
      await expect(
        resolver.isSessionActive('u1', 'sid-1'),
      ).rejects.toMatchObject({
        code: ErrorCode.AUTH_REVOCATION_CHECK_UNAVAILABLE,
        status: 503,
      });
    });
  });
});
