import type { Cache } from 'cache-manager';
import { ErrorCode } from '../../common/errors/error-codes';
import { PrismaService } from '../../prisma/prisma.service';
import { CountryAgePolicyService } from '../../common/age/country-age-policy.service';
import {
  ACTING_DENIAL_TTL_MS,
  ACTING_GRANT_TTL_MS,
  ActingForCache,
} from './acting-for.cache';
import { ActingForResolver } from './acting-for.resolver';
import {
  GUARDIAN_PENDING_SCOPES,
  GUARDIAN_VERIFIED_SCOPES,
} from './auth-principal';

const GUARDIAN = '11111111-1111-4111-8111-111111111111';
const DEPENDENT = '22222222-2222-4222-8222-222222222222';

/** Minimal in-memory CACHE_MANAGER that records the TTL of every write. */
function createFakeCache() {
  const store = new Map<string, unknown>();
  const ttls = new Map<string, number | undefined>();
  const cache = {
    get: jest.fn((key: string) => Promise.resolve(store.get(key))),
    set: jest.fn((key: string, value: unknown, ttl?: number) => {
      store.set(key, value);
      ttls.set(key, ttl);
      return Promise.resolve(undefined);
    }),
    del: jest.fn(),
  };
  return { cache: cache as unknown as Cache, store, ttls, mocks: cache };
}

describe('ActingForResolver', () => {
  let prisma: { guardianships: { findFirst: jest.Mock } };
  let policy: { getPolicy: jest.Mock };
  let fake: ReturnType<typeof createFakeCache>;
  let actingCache: ActingForCache;
  let resolver: ActingForResolver;

  const guardianshipRow = (overrides: Record<string, unknown> = {}) => ({
    guardianship_id: 'gs-1',
    consent_status: 'pending',
    dependent: { birthday: new Date('2017-04-02'), country_id: 1 },
    ...overrides,
  });

  beforeEach(() => {
    jest.useFakeTimers({ now: new Date('2026-10-16T18:00:00.000Z') });
    prisma = { guardianships: { findFirst: jest.fn() } };
    policy = {
      getPolicy: jest.fn().mockResolvedValue({
        minSelfLoginAge: 13,
        ageOfMajority: 18,
        timeZone: 'America/Mexico_City',
      }),
    };
    fake = createFakeCache();
    actingCache = new ActingForCache(fake.cache);
    resolver = new ActingForResolver(
      prisma as unknown as PrismaService,
      actingCache,
      policy as unknown as CountryAgePolicyService,
    );
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('queries guardianships with the FP-10 filter', async () => {
    prisma.guardianships.findFirst.mockResolvedValue(guardianshipRow());

    await resolver.resolve(GUARDIAN, DEPENDENT);

    expect(prisma.guardianships.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          dependent_user_id: DEPENDENT,
          guardian_user_id: GUARDIAN,
          is_custodian: false,
          is_test_data: false,
          consent_status: { in: ['pending', 'verified'] },
          dependent: {
            active: true,
            account: { none: {} },
            dependent_profile: { is: { frozen_at: null, purged_at: null } },
          },
        },
      }),
    );
  });

  it('grants the pending scopes for a pending guardianship', async () => {
    prisma.guardianships.findFirst.mockResolvedValue(guardianshipRow());

    const result = await resolver.resolve(GUARDIAN, DEPENDENT);

    expect(result).toEqual({
      granted: true,
      grant: {
        guardianshipId: 'gs-1',
        consentStatus: 'pending',
        scopes: GUARDIAN_PENDING_SCOPES,
      },
    });
  });

  it('grants the full scope set once consent is verified', async () => {
    prisma.guardianships.findFirst.mockResolvedValue(
      guardianshipRow({ consent_status: 'verified' }),
    );

    const result = await resolver.resolve(GUARDIAN, DEPENDENT);

    expect(result).toEqual({
      granted: true,
      grant: expect.objectContaining({
        consentStatus: 'verified',
        scopes: GUARDIAN_VERIFIED_SCOPES,
      }),
    });
  });

  it('still grants a 13 or 14-year-old without an account (the cutoff is the majority)', async () => {
    prisma.guardianships.findFirst.mockResolvedValue(
      guardianshipRow({
        dependent: { birthday: new Date('2012-01-15'), country_id: 1 },
      }),
    );
    await expect(resolver.resolve(GUARDIAN, DEPENDENT)).resolves.toMatchObject({
      granted: true,
    });

    fake.store.clear();
    prisma.guardianships.findFirst.mockResolvedValue(
      guardianshipRow({
        dependent: { birthday: new Date('2011-12-31'), country_id: 1 },
      }),
    );
    await expect(resolver.resolve(GUARDIAN, DEPENDENT)).resolves.toMatchObject({
      granted: true,
    });
  });

  it('denies a dependent who reached the age of majority of their country', async () => {
    prisma.guardianships.findFirst.mockResolvedValue(
      guardianshipRow({
        dependent: { birthday: new Date('2008-10-16'), country_id: 1 },
      }),
    );

    await expect(resolver.resolve(GUARDIAN, DEPENDENT)).resolves.toEqual({
      granted: false,
      cause: 'over_age',
    });
  });

  it('uses the country policy of the dependent for the majority', async () => {
    policy.getPolicy.mockResolvedValue({
      minSelfLoginAge: 13,
      ageOfMajority: 16,
      timeZone: 'America/Mexico_City',
    });
    prisma.guardianships.findFirst.mockResolvedValue(
      guardianshipRow({
        dependent: { birthday: new Date('2009-05-10'), country_id: 9 },
      }),
    );

    await expect(resolver.resolve(GUARDIAN, DEPENDENT)).resolves.toEqual({
      granted: false,
      cause: 'over_age',
    });
    expect(policy.getPolicy).toHaveBeenCalledWith(9);
  });

  it('denies a dependent without birthday', async () => {
    prisma.guardianships.findFirst.mockResolvedValue(
      guardianshipRow({ dependent: { birthday: null, country_id: null } }),
    );

    await expect(resolver.resolve(GUARDIAN, DEPENDENT)).resolves.toEqual({
      granted: false,
      cause: 'birthday_missing',
    });
  });

  describe('denials report the real cause (for the acting_for_denied log)', () => {
    const diagnostic = (overrides: Record<string, unknown> = {}) => ({
      consent_status: 'pending',
      is_custodian: false,
      is_test_data: false,
      dependent: {
        active: true,
        account: [],
        dependent_profile: { frozen_at: null, purged_at: null },
      },
      ...overrides,
    });

    const denyWith = async (row: unknown) => {
      fake.store.clear();
      prisma.guardianships.findFirst
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(row);
      return resolver.resolve(GUARDIAN, DEPENDENT);
    };

    it.each([
      ['foreign or unknown', null, 'no_guardianship'],
      ['revoked', diagnostic({ consent_status: 'revoked' }), 'revoked'],
      [
        'custodian row',
        diagnostic({ is_custodian: true }),
        'custodian_or_external',
      ],
      ['test placeholder', diagnostic({ is_test_data: true }), 'test_data'],
      [
        'inactive dependent',
        diagnostic({
          dependent: {
            active: false,
            account: [],
            dependent_profile: { frozen_at: null, purged_at: null },
          },
        }),
        'dependent_inactive',
      ],
      [
        'dependent with an account',
        diagnostic({
          dependent: {
            active: true,
            account: [{ id: 'acc' }],
            dependent_profile: { frozen_at: null, purged_at: null },
          },
        }),
        'has_account',
      ],
      [
        'no dependent profile',
        diagnostic({
          dependent: { active: true, account: [], dependent_profile: null },
        }),
        'no_dependent_profile',
      ],
      [
        'frozen dependent',
        diagnostic({
          dependent: {
            active: true,
            account: [],
            dependent_profile: { frozen_at: new Date(), purged_at: null },
          },
        }),
        'frozen',
      ],
    ])('%s', async (_label, row, cause) => {
      await expect(denyWith(row)).resolves.toEqual({ granted: false, cause });
    });

    it('falls back to unknown when the diagnostic query itself fails', async () => {
      fake.store.clear();
      prisma.guardianships.findFirst
        .mockResolvedValueOnce(null)
        .mockRejectedValueOnce(new Error('boom'));

      await expect(resolver.resolve(GUARDIAN, DEPENDENT)).resolves.toEqual({
        granted: false,
        cause: 'unknown',
      });
    });
  });

  describe('cache', () => {
    it('serves a cache hit without touching the database', async () => {
      prisma.guardianships.findFirst.mockResolvedValue(guardianshipRow());
      await resolver.resolve(GUARDIAN, DEPENDENT);
      prisma.guardianships.findFirst.mockClear();

      const second = await resolver.resolve(GUARDIAN, DEPENDENT);

      expect(second).toMatchObject({ granted: true });
      expect(prisma.guardianships.findFirst).not.toHaveBeenCalled();
    });

    it('stores a grant for 60s and a denial for 10s under the epoch key', async () => {
      prisma.guardianships.findFirst.mockResolvedValue(guardianshipRow());
      await resolver.resolve(GUARDIAN, DEPENDENT);
      const grantKey = `acting:v1:${DEPENDENT}:0:${GUARDIAN}`;
      expect(fake.ttls.get(grantKey)).toBe(ACTING_GRANT_TTL_MS);
      expect(ACTING_GRANT_TTL_MS).toBe(60_000);

      const other = '33333333-3333-4333-8333-333333333333';
      prisma.guardianships.findFirst.mockResolvedValue(null);
      await resolver.resolve(other, DEPENDENT);
      expect(fake.ttls.get(`acting:v1:${DEPENDENT}:0:${other}`)).toBe(
        ACTING_DENIAL_TTL_MS,
      );
      expect(ACTING_DENIAL_TTL_MS).toBe(10_000);
    });

    it('an epoch bump orphans the cached decision and re-reads the database', async () => {
      prisma.guardianships.findFirst.mockResolvedValue(guardianshipRow());
      await resolver.resolve(GUARDIAN, DEPENDENT);

      await actingCache.bump(DEPENDENT);
      expect(fake.store.get(`acting:epoch:${DEPENDENT}`)).toBe(Date.now());

      // The guardianship was revoked meanwhile: the new epoch must not see the old grant.
      prisma.guardianships.findFirst.mockReset();
      prisma.guardianships.findFirst
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({
          consent_status: 'revoked',
          is_custodian: false,
          is_test_data: false,
          dependent: {
            active: true,
            account: [],
            dependent_profile: { frozen_at: null, purged_at: null },
          },
        });

      await expect(resolver.resolve(GUARDIAN, DEPENDENT)).resolves.toEqual({
        granted: false,
        cause: 'revoked',
      });
    });

    it('a Redis outage falls back to the database and never fails open', async () => {
      fake.mocks.get.mockRejectedValue(new Error('redis down'));
      fake.mocks.set.mockRejectedValue(new Error('redis down'));
      prisma.guardianships.findFirst.mockResolvedValue(guardianshipRow());

      await expect(
        resolver.resolve(GUARDIAN, DEPENDENT),
      ).resolves.toMatchObject({ granted: true });
      expect(prisma.guardianships.findFirst).toHaveBeenCalledTimes(1);

      prisma.guardianships.findFirst.mockReset();
      prisma.guardianships.findFirst
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(null);
      await expect(
        resolver.resolve(GUARDIAN, DEPENDENT),
      ).resolves.toMatchObject({ granted: false });
    });

    it('a failing epoch bump is logged, not thrown', async () => {
      fake.mocks.set.mockRejectedValue(new Error('redis down'));

      await expect(actingCache.bump(DEPENDENT)).resolves.toBeUndefined();
    });
  });

  it('a database failure is a 503 AUTH_REVOCATION_CHECK_UNAVAILABLE', async () => {
    prisma.guardianships.findFirst.mockRejectedValue(new Error('db down'));

    await expect(resolver.resolve(GUARDIAN, DEPENDENT)).rejects.toMatchObject({
      code: ErrorCode.AUTH_REVOCATION_CHECK_UNAVAILABLE,
    });
    await expect(resolver.resolve(GUARDIAN, DEPENDENT)).rejects.toMatchObject({
      status: 503,
    });
  });

  it('a Redis outage plus a database failure is still a 503 (never an allow)', async () => {
    fake.mocks.get.mockRejectedValue(new Error('redis down'));
    prisma.guardianships.findFirst.mockRejectedValue(new Error('db down'));

    await expect(resolver.resolve(GUARDIAN, DEPENDENT)).rejects.toMatchObject({
      code: ErrorCode.AUTH_REVOCATION_CHECK_UNAVAILABLE,
    });
  });
});
