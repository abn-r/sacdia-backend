import { Prisma } from '@prisma/client';
import { ErrorCode } from '../common/errors/error-codes';
import { LinkCodeFailureCounter } from './link-code-failure-counter';
import { LinkCodesService } from './link-codes.service';
import {
  deriveLinkCodeKey,
  hashLinkCode,
  normalizeLinkCode,
} from './link-code.util';

const SECRET = 's'.repeat(32);
const KEY = deriveLinkCodeKey(SECRET);
const DEPENDENT = '33333333-3333-4333-8333-333333333333';
const INVITER = '44444444-4444-4444-8444-444444444444';
const REDEEMER = '55555555-5555-4555-8555-555555555555';
const DIRECTOR = '66666666-6666-4666-8666-666666666666';
const REL = '77777777-7777-4777-8777-777777777777';
const HOUR = 3_600_000;

const redeemDto = (code = '7KQ4-M9TX') =>
  ({ code, relationship_type_id: REL, sworn_declaration: true }) as any;

function codeRow(overrides: Record<string, unknown> = {}) {
  return {
    link_code_id: 'lc-1',
    code_hash: 'x'.repeat(64),
    dependent_user_id: DEPENDENT,
    purpose: 'second_guardian',
    issued_by_user_id: INVITER,
    issued_for_club_section_id: null,
    expires_at: new Date(Date.now() + HOUR),
    consumed_at: null,
    ...overrides,
  };
}

/**
 * Prisma double whose transaction really rolls back: writes made inside the
 * callback only reach `committed` when the callback resolves.
 */
function setup() {
  const committed = { codeConsumed: false };
  const pending = { codeConsumed: false };
  const created: any[] = [];
  const updates: Array<{ model: string; args: any }> = [];

  const tx: any = {
    $executeRaw: jest.fn().mockResolvedValue(1),
    guardianship_link_codes: {
      findFirst: jest.fn().mockResolvedValue(codeRow()),
      updateMany: jest.fn().mockImplementation(async (args: any) => {
        updates.push({ model: 'link_codes', args });
        if (args.data.consumed_at) {
          pending.codeConsumed = true;
          return { count: 1 };
        }
        return { count: 1 };
      }),
      create: jest.fn().mockResolvedValue({}),
    },
    users: { findFirst: jest.fn().mockResolvedValue({ user_id: DEPENDENT }) },
    dependent_profiles: { upsert: jest.fn().mockResolvedValue({}) },
    supervised_logins: { upsert: jest.fn().mockResolvedValue({}) },
    guardianships: {
      findFirst: jest.fn(),
      count: jest.fn().mockResolvedValue(1),
      create: jest.fn().mockImplementation(async (args: any) => {
        created.push(args.data);
        return { guardianship_id: 'gs-new' };
      }),
      updateMany: jest.fn().mockImplementation(async (args: any) => {
        updates.push({ model: 'guardianships', args });
        return { count: 1 };
      }),
    },
  };

  const prisma: any = {
    guardianships: {
      findFirst: jest.fn(),
      count: jest.fn().mockResolvedValue(1),
    },
    users: { findFirst: jest.fn() },
    dependent_profiles: { findFirst: jest.fn() },
    club_role_assignments: { findFirst: jest.fn() },
    $transaction: jest.fn(async (callback: (t: any) => unknown) => {
      pending.codeConsumed = committed.codeConsumed;
      // A throwing callback never reaches the next line: nothing is committed.
      const result = await callback(tx);
      committed.codeConsumed = pending.codeConsumed;
      return result;
    }),
  };

  // A cache without a Redis store: the counter uses its in-process window.
  const failures = new LinkCodeFailureCounter({ stores: [] } as any);
  const config = { get: jest.fn().mockReturnValue(SECRET) };
  const actingForCache = { bump: jest.fn().mockResolvedValue(undefined) };
  const guardianships = {
    assertAdult: jest.fn().mockResolvedValue({}),
    assertRelationshipType: jest.fn().mockResolvedValue(undefined),
    getSummaryForGuardian: jest.fn().mockResolvedValue({ user_id: DEPENDENT }),
  };

  const agePolicy = {
    getPolicy: jest.fn().mockResolvedValue({
      minSelfLoginAge: 13,
      ageOfMajority: 18,
      timeZone: 'America/Mexico_City',
    }),
  };
  const deviceRevoker = {
    revokeAllForDependent: jest.fn().mockResolvedValue(0),
    revokeByGuardianship: jest.fn().mockResolvedValue(0),
  };

  const service = new LinkCodesService(
    prisma,
    config as any,
    failures,
    actingForCache as any,
    guardianships as any,
    agePolicy as any,
    deviceRevoker as any,
  );
  return {
    service,
    prisma,
    tx,
    agePolicy,
    deviceRevoker,
    failures,
    actingForCache,
    guardianships,
    committed,
    created,
    updates,
  };
}

/** The guardian's own row as issueSecondGuardianCode reads it. */
const ownRow = (overrides: Record<string, unknown> = {}) => ({
  guardianship_id: 'g',
  consent_status: 'verified',
  dependent: { account: [] as Array<{ id: string }> },
  ...overrides,
});

async function errorOf(promise: Promise<unknown>) {
  try {
    await promise;
  } catch (error) {
    return error as { code?: string; getStatus?: () => number };
  }
  return undefined;
}

describe('LinkCodesService.issueSecondGuardianCode', () => {
  it('404s for anyone who is not an active guardian of the dependent', async () => {
    const { service, prisma, tx } = setup();
    prisma.guardianships.findFirst.mockResolvedValue(null);
    const error = await errorOf(
      service.issueSecondGuardianCode(INVITER, DEPENDENT),
    );
    expect(error?.code).toBe(ErrorCode.GUARDIANSHIP_NOT_FOUND);
    expect(tx.guardianship_link_codes.create).not.toHaveBeenCalled();
  });

  it('refuses at 4 active guardians with 409 GUARDIAN_LIMIT_REACHED', async () => {
    const { service, prisma } = setup();
    prisma.guardianships.findFirst.mockResolvedValue(ownRow());
    prisma.guardianships.count.mockResolvedValue(4);
    const error = await errorOf(
      service.issueSecondGuardianCode(INVITER, DEPENDENT),
    );
    expect(error?.code).toBe(ErrorCode.GUARDIANSHIP_GUARDIAN_LIMIT_REACHED);
    expect(error?.getStatus?.()).toBe(409);
  });

  it('issues XXXX-XXXX, stores only the HMAC, expires in 72h and revokes open codes first', async () => {
    const { service, prisma, tx } = setup();
    prisma.guardianships.findFirst.mockResolvedValue(ownRow());
    prisma.guardianships.count.mockResolvedValue(1);
    const before = Date.now();

    const issued = await service.issueSecondGuardianCode(INVITER, DEPENDENT);

    expect(issued.code).toMatch(/^[0-9A-Z]{4}-[0-9A-Z]{4}$/);
    const ttl = new Date(issued.expires_at).getTime() - before;
    expect(ttl).toBeGreaterThanOrEqual(72 * HOUR - 2000);
    expect(ttl).toBeLessThanOrEqual(72 * HOUR + 2000);

    const stored = tx.guardianship_link_codes.create.mock.calls[0][0].data;
    expect(stored.code_hash).toBe(
      hashLinkCode(normalizeLinkCode(issued.code), KEY),
    );
    expect(stored.code_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(stored)).not.toContain(issued.code);
    expect(JSON.stringify(stored)).not.toContain(
      normalizeLinkCode(issued.code),
    );
    expect(stored).toMatchObject({
      dependent_user_id: DEPENDENT,
      purpose: 'second_guardian',
      issued_by_user_id: INVITER,
      issued_for_club_section_id: null,
    });

    // Old open codes of the same (dependent, purpose) are revoked BEFORE the new one.
    const revoke = tx.guardianship_link_codes.updateMany.mock.calls[0][0];
    expect(revoke.where).toMatchObject({
      dependent_user_id: DEPENDENT,
      purpose: 'second_guardian',
      consumed_at: null,
      revoked_at: null,
    });
    expect(
      tx.guardianship_link_codes.updateMany.mock.invocationCallOrder[0],
    ).toBeLessThan(
      tx.guardianship_link_codes.create.mock.invocationCallOrder[0],
    );
  });

  it('retries on a code hash collision', async () => {
    const { service, prisma, tx } = setup();
    prisma.guardianships.findFirst.mockResolvedValue(ownRow());
    tx.guardianship_link_codes.create
      .mockRejectedValueOnce(
        new Prisma.PrismaClientKnownRequestError('unique', {
          code: 'P2002',
          clientVersion: 'test',
        }),
      )
      .mockResolvedValueOnce({});

    const issued = await service.issueSecondGuardianCode(INVITER, DEPENDENT);

    expect(issued.code).toBeDefined();
    expect(tx.guardianship_link_codes.create).toHaveBeenCalledTimes(2);
  });
});

describe('LinkCodesService.issueDirectorClaimCode', () => {
  it('404s when the dependent is not in that section', async () => {
    const { service, prisma } = setup();
    prisma.dependent_profiles.findFirst.mockResolvedValue({
      user_id: DEPENDENT,
    });
    prisma.club_role_assignments.findFirst.mockResolvedValue(null);
    expect(
      (await errorOf(service.issueDirectorClaimCode(DIRECTOR, 5, DEPENDENT)))
        ?.code,
    ).toBe(ErrorCode.GUARDIANSHIP_NOT_FOUND);
  });

  it('404s for a user that is not a dependent', async () => {
    const { service, prisma } = setup();
    prisma.dependent_profiles.findFirst.mockResolvedValue(null);
    expect(
      (await errorOf(service.issueDirectorClaimCode(DIRECTOR, 5, DEPENDENT)))
        ?.code,
    ).toBe(ErrorCode.GUARDIANSHIP_NOT_FOUND);
  });

  it('refuses when a family already has the child', async () => {
    const { service, prisma } = setup();
    prisma.dependent_profiles.findFirst.mockResolvedValue({
      user_id: DEPENDENT,
    });
    prisma.club_role_assignments.findFirst.mockResolvedValue({
      assignment_id: 'a',
    });
    prisma.guardianships.count.mockResolvedValue(1);
    const error = await errorOf(
      service.issueDirectorClaimCode(DIRECTOR, 5, DEPENDENT),
    );
    expect(error?.code).toBe(ErrorCode.GUARDIANSHIP_ALREADY_GUARDIAN);
  });

  it('issues a 7 day code tied to the section', async () => {
    const { service, prisma, tx } = setup();
    prisma.dependent_profiles.findFirst.mockResolvedValue({
      user_id: DEPENDENT,
    });
    prisma.club_role_assignments.findFirst.mockResolvedValue({
      assignment_id: 'a',
    });
    prisma.guardianships.count.mockResolvedValue(0);
    const before = Date.now();

    const issued = await service.issueDirectorClaimCode(DIRECTOR, 5, DEPENDENT);

    const ttl = new Date(issued.expires_at).getTime() - before;
    expect(ttl).toBeGreaterThanOrEqual(7 * 24 * HOUR - 2000);
    expect(ttl).toBeLessThanOrEqual(7 * 24 * HOUR + 2000);
    expect(
      tx.guardianship_link_codes.create.mock.calls[0][0].data,
    ).toMatchObject({
      purpose: 'director_claim',
      issued_for_club_section_id: 5,
      issued_by_user_id: DIRECTOR,
    });
  });
});

describe('LinkCodesService.redeem: second guardian', () => {
  it('creates a verified guardian_invite row when the inviter is verified', async () => {
    const { service, tx, created, actingForCache, guardianships } = setup();
    tx.guardianships.findFirst
      .mockResolvedValueOnce({
        guardianship_id: 'g-inv',
        consent_status: 'verified',
      })
      .mockResolvedValueOnce(null); // not already a guardian
    tx.guardianships.count.mockResolvedValue(1);

    const result = await service.redeem(REDEEMER, redeemDto('7kq4 m9tx'));

    expect(created).toEqual([
      expect.objectContaining({
        dependent_user_id: DEPENDENT,
        guardian_user_id: REDEEMER,
        relationship_type_id: REL,
        is_primary: false,
        consent_status: 'verified',
        verification_method: 'guardian_invite',
        verified_by_user_id: INVITER,
        invited_by_guardianship_id: 'g-inv',
        sworn_declaration_at: expect.any(Date),
      }),
    ]);
    expect(actingForCache.bump).toHaveBeenCalledWith(DEPENDENT);
    expect(guardianships.getSummaryForGuardian).toHaveBeenCalledWith(
      REDEEMER,
      DEPENDENT,
    );
    expect(result).toEqual({ user_id: DEPENDENT });
  });

  it('creates a pending row when the inviter is still pending', async () => {
    const { service, tx, created } = setup();
    tx.guardianships.findFirst
      .mockResolvedValueOnce({
        guardianship_id: 'g-inv',
        consent_status: 'pending',
      })
      .mockResolvedValueOnce(null);

    await service.redeem(REDEEMER, redeemDto());

    expect(created[0]).toMatchObject({
      consent_status: 'pending',
      verification_method: null,
      verified_at: null,
    });
  });

  it('hashes the NORMALIZED input, so every spelling finds the same row', async () => {
    const { service, tx } = setup();
    tx.guardianships.findFirst
      .mockResolvedValueOnce({
        guardianship_id: 'g-inv',
        consent_status: 'pending',
      })
      .mockResolvedValueOnce(null);

    await service.redeem(REDEEMER, redeemDto('7kq4-m9tx'));

    expect(
      tx.guardianship_link_codes.findFirst.mock.calls[0][0].where.code_hash,
    ).toBe(hashLinkCode('7KQ4M9TX', KEY));
  });

  it('single use: the loser of a race gets the uniform 400 and the code stays with the winner', async () => {
    const { service, tx } = setup();
    tx.guardianship_link_codes.updateMany.mockResolvedValue({ count: 0 });

    const error = await errorOf(service.redeem(REDEEMER, redeemDto()));

    expect(error?.code).toBe(ErrorCode.GUARDIANSHIP_LINK_CODE_INVALID);
    expect(error?.getStatus?.()).toBe(400);
    expect(tx.guardianships.create).not.toHaveBeenCalled();
  });

  it('atomically consumes only an unconsumed, unrevoked, unexpired code', async () => {
    const { service, tx } = setup();
    tx.guardianships.findFirst
      .mockResolvedValueOnce({
        guardianship_id: 'g-inv',
        consent_status: 'pending',
      })
      .mockResolvedValueOnce(null);

    await service.redeem(REDEEMER, redeemDto());

    expect(tx.guardianship_link_codes.updateMany).toHaveBeenCalledWith({
      where: {
        link_code_id: 'lc-1',
        consumed_at: null,
        revoked_at: null,
        expires_at: { gt: expect.any(Date) },
      },
      data: { consumed_at: expect.any(Date), consumed_by_user_id: REDEEMER },
    });
  });

  it.each([
    ['unknown / expired / consumed / revoked', 'none'],
    ['malformed', 'bad'],
  ])(
    'answers %s with the same 400 and counts a failure',
    async (_label, kind) => {
      const { service, tx, prisma, failures } = setup();
      if (kind === 'none') {
        tx.guardianship_link_codes.findFirst.mockResolvedValue(null);
      }
      const error = await errorOf(
        service.redeem(
          REDEEMER,
          redeemDto(kind === 'bad' ? 'hello' : '7KQ4-M9TX'),
        ),
      );
      expect(error?.code).toBe(ErrorCode.GUARDIANSHIP_LINK_CODE_INVALID);
      expect(error?.getStatus?.()).toBe(400);
      expect(await failures.current(REDEEMER)).toBe(1);
      if (kind === 'bad') {
        expect(prisma.$transaction).not.toHaveBeenCalled();
      }
    },
  );

  it('409 ALREADY_GUARDIAN rolls back: the code is NOT consumed and no failure is counted', async () => {
    const { service, tx, committed, failures } = setup();
    tx.guardianships.findFirst
      .mockResolvedValueOnce({
        guardianship_id: 'g-inv',
        consent_status: 'pending',
      })
      .mockResolvedValueOnce({ guardianship_id: 'g-me' });

    const error = await errorOf(service.redeem(REDEEMER, redeemDto()));

    expect(error?.code).toBe(ErrorCode.GUARDIANSHIP_ALREADY_GUARDIAN);
    expect(error?.getStatus?.()).toBe(409);
    expect(committed.codeConsumed).toBe(false);
    expect(await failures.current(REDEEMER)).toBe(0);
  });

  it('409 GUARDIAN_LIMIT_REACHED at 4 guardians also leaves the code unconsumed', async () => {
    const { service, tx, committed, created } = setup();
    tx.guardianships.findFirst
      .mockResolvedValueOnce({
        guardianship_id: 'g-inv',
        consent_status: 'pending',
      })
      .mockResolvedValueOnce(null);
    tx.guardianships.count.mockResolvedValue(4);

    const error = await errorOf(service.redeem(REDEEMER, redeemDto()));

    expect(error?.code).toBe(ErrorCode.GUARDIANSHIP_GUARDIAN_LIMIT_REACHED);
    expect(committed.codeConsumed).toBe(false);
    expect(created).toHaveLength(0);
  });

  it('a successful redeem does commit the consumption', async () => {
    const { service, tx, committed } = setup();
    tx.guardianships.findFirst
      .mockResolvedValueOnce({
        guardianship_id: 'g-inv',
        consent_status: 'pending',
      })
      .mockResolvedValueOnce(null);
    await service.redeem(REDEEMER, redeemDto());
    expect(committed.codeConsumed).toBe(true);
  });

  it('refuses a redeemer who is not an adult before touching the code', async () => {
    const { service, prisma, guardianships } = setup();
    guardianships.assertAdult.mockRejectedValue(
      Object.assign(new Error('x'), {
        code: ErrorCode.GUARDIANSHIP_GUARDIAN_NOT_ADULT,
      }),
    );
    const error = await errorOf(service.redeem(REDEEMER, redeemDto()));
    expect(error?.code).toBe(ErrorCode.GUARDIANSHIP_GUARDIAN_NOT_ADULT);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('refuses a disallowed relationship type before touching the code', async () => {
    const { service, prisma, guardianships } = setup();
    guardianships.assertRelationshipType.mockRejectedValue(
      Object.assign(new Error('x'), {
        code: ErrorCode.GUARDIANSHIP_RELATIONSHIP_TYPE_NOT_ALLOWED,
      }),
    );
    const error = await errorOf(service.redeem(REDEEMER, redeemDto()));
    expect(error?.code).toBe(
      ErrorCode.GUARDIANSHIP_RELATIONSHIP_TYPE_NOT_ALLOWED,
    );
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('is invalid when the inviter left after issuing the code', async () => {
    const { service, tx, committed } = setup();
    tx.guardianships.findFirst.mockResolvedValueOnce(null);
    const error = await errorOf(service.redeem(REDEEMER, redeemDto()));
    expect(error?.code).toBe(ErrorCode.GUARDIANSHIP_LINK_CODE_INVALID);
    expect(committed.codeConsumed).toBe(false);
  });

  it('is invalid when the dependent got an account, froze or is gone', async () => {
    const { service, tx } = setup();
    tx.users.findFirst.mockResolvedValue(null);
    const error = await errorOf(service.redeem(REDEEMER, redeemDto()));
    expect(error?.code).toBe(ErrorCode.GUARDIANSHIP_LINK_CODE_INVALID);
  });
});

describe('LinkCodesService.redeem: self-redeem (four-eyes)', () => {
  it.each([
    ['second_guardian', INVITER, 'second-guardian invite'],
    ['director_claim', DIRECTOR, 'director claim code'],
  ])(
    'refuses to redeem a %s code the redeemer issued: 403, nothing consumed or created',
    async (purpose, issuer, _label) => {
      const { service, tx, committed, failures, actingForCache } = setup();
      tx.guardianship_link_codes.findFirst.mockResolvedValue(
        codeRow({ purpose, issued_by_user_id: issuer }),
      );

      const error = await errorOf(service.redeem(issuer, redeemDto()));

      expect(error?.code).toBe(ErrorCode.GUARDIANSHIP_LINK_CODE_SELF_REDEEM);
      expect(error?.getStatus?.()).toBe(403);
      expect(tx.guardianship_link_codes.updateMany).not.toHaveBeenCalled();
      expect(tx.guardianships.create).not.toHaveBeenCalled();
      expect(tx.guardianships.updateMany).not.toHaveBeenCalled();
      expect(committed.codeConsumed).toBe(false);
      expect(actingForCache.bump).not.toHaveBeenCalled();
      // It is not a wrong guess: the brute-force counter stays untouched.
      expect(await failures.current(issuer)).toBe(0);
    },
  );

  it('still lets someone else redeem the same code afterwards', async () => {
    const { service, tx, created } = setup();
    tx.guardianships.findFirst
      .mockResolvedValueOnce({
        guardianship_id: 'g-inv',
        consent_status: 'pending',
      })
      .mockResolvedValueOnce(null);
    await service.redeem(REDEEMER, redeemDto());
    expect(created).toHaveLength(1);
  });

  it('locks the dependent before consuming the code', async () => {
    const { service, tx } = setup();
    tx.$executeRaw = jest.fn().mockResolvedValue(1);
    tx.guardianships.findFirst
      .mockResolvedValueOnce({
        guardianship_id: 'g-inv',
        consent_status: 'pending',
      })
      .mockResolvedValueOnce(null);

    await service.redeem(REDEEMER, redeemDto());

    expect(tx.$executeRaw).toHaveBeenCalledTimes(1);
    expect(tx.$executeRaw.mock.invocationCallOrder[0]).toBeLessThan(
      tx.guardianship_link_codes.updateMany.mock.invocationCallOrder[0],
    );
  });
});

describe('LinkCodesService.redeem: lockout', () => {
  const T0 = 1_800_000_000_000;
  let nowSpy: jest.SpyInstance;

  beforeEach(() => {
    nowSpy = jest.spyOn(Date, 'now').mockReturnValue(T0);
  });
  afterEach(() => nowSpy.mockRestore());

  async function failTimes(
    service: LinkCodesService,
    tx: any,
    times: number,
    at: number,
  ) {
    tx.guardianship_link_codes.findFirst.mockResolvedValue(null);
    for (let attempt = 0; attempt < times; attempt += 1) {
      nowSpy.mockReturnValue(at);
      await errorOf(service.redeem(REDEEMER, redeemDto()));
    }
  }

  it('10 failures lock the user: 429 even for a valid code, which stays unconsumed', async () => {
    const { service, tx, prisma, committed } = setup();
    await failTimes(service, tx, 10, T0);
    prisma.$transaction.mockClear();
    tx.guardianship_link_codes.findFirst.mockResolvedValue(codeRow());

    const error = await errorOf(service.redeem(REDEEMER, redeemDto()));

    expect(error?.code).toBe(ErrorCode.GUARDIANSHIP_LINK_CODE_LOCKED);
    expect(error?.getStatus?.()).toBe(429);
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(committed.codeConsumed).toBe(false);
  });

  it('9 failures do not lock', async () => {
    const { service, tx } = setup();
    await failTimes(service, tx, 9, T0);
    tx.guardianship_link_codes.findFirst.mockResolvedValue(null);
    const error = await errorOf(service.redeem(REDEEMER, redeemDto()));
    expect(error?.code).toBe(ErrorCode.GUARDIANSHIP_LINK_CODE_INVALID);
  });

  it('the window is anchored at the FIRST failure and later failures never extend it', async () => {
    const { service, tx, failures } = setup();
    await failTimes(service, tx, 1, T0);
    await failTimes(service, tx, 9, T0 + 23 * HOUR);
    expect(await failures.current(REDEEMER)).toBe(10);

    // Still locked at 23h59.
    nowSpy.mockReturnValue(T0 + 24 * HOUR - 1);
    expect((await errorOf(service.redeem(REDEEMER, redeemDto())))?.code).toBe(
      ErrorCode.GUARDIANSHIP_LINK_CODE_LOCKED,
    );

    // 24h after the FIRST failure the lockout clears.
    nowSpy.mockReturnValue(T0 + 24 * HOUR);
    expect((await errorOf(service.redeem(REDEEMER, redeemDto())))?.code).toBe(
      ErrorCode.GUARDIANSHIP_LINK_CODE_INVALID,
    );
    expect(await failures.current(REDEEMER)).toBe(1);
  });

  it('keeps counters per user', async () => {
    const { service, tx } = setup();
    await failTimes(service, tx, 10, T0);
    tx.guardianship_link_codes.findFirst.mockResolvedValue(null);
    const other = await errorOf(
      service.redeem('99999999-9999-4999-8999-999999999999', redeemDto()),
    );
    expect(other?.code).toBe(ErrorCode.GUARDIANSHIP_LINK_CODE_INVALID);
  });

  it('does not lock anyone out when the cache is down', async () => {
    const { service, tx, failures } = setup();
    jest.spyOn(failures, 'current').mockRejectedValue(new Error('redis down'));
    jest
      .spyOn(failures, 'increment')
      .mockRejectedValue(new Error('redis down'));
    tx.guardianship_link_codes.findFirst.mockResolvedValue(null);
    const error = await errorOf(service.redeem(REDEEMER, redeemDto()));
    expect(error?.code).toBe(ErrorCode.GUARDIANSHIP_LINK_CODE_INVALID);
  });
});

describe('LinkCodesService.redeem: director claim', () => {
  const claimCode = codeRow({
    purpose: 'director_claim',
    issued_by_user_id: DIRECTOR,
    issued_for_club_section_id: 5,
  });

  it('revokes the custody row FIRST, then inserts a pending primary (no inherited verification)', async () => {
    const { service, tx, updates, created, actingForCache } = setup();
    tx.guardianship_link_codes.findFirst.mockResolvedValue(claimCode);
    tx.guardianships.count.mockResolvedValue(0);

    await service.redeem(REDEEMER, redeemDto());

    const revoke = tx.guardianships.updateMany.mock.calls[0][0];
    expect(revoke).toEqual({
      where: {
        dependent_user_id: DEPENDENT,
        guardian_user_id: null,
        consent_status: { not: 'revoked' },
      },
      data: {
        consent_status: 'revoked',
        revoked_at: expect.any(Date),
        revoked_reason: 'claimed',
        modified_at: expect.any(Date),
      },
    });
    expect(
      tx.guardianships.updateMany.mock.invocationCallOrder[0],
    ).toBeLessThan(tx.guardianships.create.mock.invocationCallOrder[0]);
    expect(created).toEqual([
      expect.objectContaining({
        dependent_user_id: DEPENDENT,
        guardian_user_id: REDEEMER,
        is_primary: true,
        consent_status: 'pending',
        sworn_declaration_at: expect.any(Date),
      }),
    ]);
    expect(created[0]).not.toHaveProperty('verified_at');
    expect(created[0]).not.toHaveProperty('verification_method');
    expect(updates.length).toBeGreaterThan(0);
    expect(actingForCache.bump).toHaveBeenCalledWith(DEPENDENT);
  });

  it('is invalid when a family claimed the child first', async () => {
    const { service, tx, committed } = setup();
    tx.guardianship_link_codes.findFirst.mockResolvedValue(claimCode);
    tx.guardianships.count.mockResolvedValue(1);

    const error = await errorOf(service.redeem(REDEEMER, redeemDto()));

    expect(error?.code).toBe(ErrorCode.GUARDIANSHIP_LINK_CODE_INVALID);
    expect(committed.codeConsumed).toBe(false);
    expect(tx.guardianships.create).not.toHaveBeenCalled();
  });
});

describe('LinkCodesService.issueSecondGuardianCode for a teen (phase 3a)', () => {
  it('a PENDING guardian of a teen (account holder) cannot invite another adult: 409 GUARDIANSHIP_CONSENT_NOT_VERIFIED', async () => {
    const { service, prisma, tx } = setup();
    prisma.guardianships.findFirst.mockResolvedValue(
      ownRow({
        consent_status: 'pending',
        dependent: { account: [{ id: 'acc' }] },
      }),
    );

    const error = await errorOf(
      service.issueSecondGuardianCode(INVITER, DEPENDENT),
    );

    expect(error?.code).toBe(ErrorCode.GUARDIANSHIP_CONSENT_NOT_VERIFIED);
    expect(error?.getStatus?.()).toBe(409);
    expect(tx.guardianship_link_codes.create).not.toHaveBeenCalled();
  });

  it('a VERIFIED guardian of a teen can', async () => {
    const { service, prisma } = setup();
    prisma.guardianships.findFirst.mockResolvedValue(
      ownRow({ dependent: { account: [{ id: 'acc' }] } }),
    );
    prisma.guardianships.count.mockResolvedValue(1);
    await expect(
      service.issueSecondGuardianCode(INVITER, DEPENDENT),
    ).resolves.toMatchObject({ code: expect.any(String) });
  });

  it('a pending guardian of a plain dependent (no account) still can (Phase 2 behavior)', async () => {
    const { service, prisma } = setup();
    prisma.guardianships.findFirst.mockResolvedValue(
      ownRow({ consent_status: 'pending' }),
    );
    prisma.guardianships.count.mockResolvedValue(1);
    await expect(
      service.issueSecondGuardianCode(INVITER, DEPENDENT),
    ).resolves.toBeDefined();
  });
});

describe('LinkCodesService.issueTeenGuardianLink (phase 3a)', () => {
  const TEEN = '88888888-8888-4888-8888-888888888888';
  const birthdayOf = (years: number) => {
    const d = new Date();
    d.setUTCFullYear(d.getUTCFullYear() - years);
    d.setUTCDate(d.getUTCDate() - 5);
    return d;
  };
  const teenRow = (overrides: Record<string, unknown> = {}) => ({
    birthday: birthdayOf(15),
    country_id: null,
    dependent_profile: null,
    ...overrides,
  });

  function arrange(teen: unknown, linked = 0) {
    const ctx = setup();
    ctx.prisma.users.findFirst.mockResolvedValue(teen);
    ctx.prisma.guardianships.count.mockResolvedValue(linked);
    return ctx;
  }

  it('issues XXXX-XXXX valid 72h, issued by and for the teen, HMAC at rest, replacing the open codes of the same (teen, purpose)', async () => {
    const { service, tx } = arrange(teenRow());
    const before = Date.now();

    const issued = await service.issueTeenGuardianLink(TEEN);

    expect(issued.code).toMatch(/^[0-9A-Z]{4}-[0-9A-Z]{4}$/);
    const ttl = new Date(issued.expires_at).getTime() - before;
    expect(ttl).toBeGreaterThanOrEqual(72 * HOUR - 2000);
    expect(ttl).toBeLessThanOrEqual(72 * HOUR + 2000);

    const stored = tx.guardianship_link_codes.create.mock.calls[0][0].data;
    expect(stored).toMatchObject({
      dependent_user_id: TEEN,
      purpose: 'teen_guardian_link',
      issued_by_user_id: TEEN,
      issued_for_club_section_id: null,
    });
    expect(stored.code_hash).toBe(
      hashLinkCode(normalizeLinkCode(issued.code), KEY),
    );
    expect(JSON.stringify(stored)).not.toContain(issued.code);
    expect(
      tx.guardianship_link_codes.updateMany.mock.calls[0][0].where,
    ).toMatchObject({
      dependent_user_id: TEEN,
      purpose: 'teen_guardian_link',
      consumed_at: null,
      revoked_at: null,
    });
  });

  it('a second issue kills the first (the open code of the same purpose is revoked before the new one is created)', async () => {
    const { service, tx } = arrange(teenRow());
    await service.issueTeenGuardianLink(TEEN);
    await service.issueTeenGuardianLink(TEEN);

    expect(tx.guardianship_link_codes.updateMany).toHaveBeenCalledTimes(2);
    expect(tx.guardianship_link_codes.create).toHaveBeenCalledTimes(2);
    const [firstCreate, secondCreate] =
      tx.guardianship_link_codes.create.mock.calls.map(
        (call: any[]) => call[0].data.code_hash,
      );
    expect(firstCreate).not.toBe(secondCreate);
  });

  it('only reads an active account holder', async () => {
    const { service, prisma } = arrange(teenRow());
    await service.issueTeenGuardianLink(TEEN);
    expect(prisma.users.findFirst.mock.calls[0][0].where).toEqual({
      user_id: TEEN,
      active: true,
      account: { some: {} },
    });
  });

  it('an adult (kind user passes the scope check) is refused 403 PRINCIPAL_SCOPE_DENIED', async () => {
    const { service, tx } = arrange(teenRow({ birthday: birthdayOf(30) }));
    const error = await errorOf(service.issueTeenGuardianLink(TEEN));
    expect(error?.code).toBe(ErrorCode.PRINCIPAL_SCOPE_DENIED);
    expect(error?.getStatus?.()).toBe(403);
    expect(tx.guardianship_link_codes.create).not.toHaveBeenCalled();
  });

  it('turns 18 today: no more codes (majority by the country calendar)', async () => {
    jest.useFakeTimers({ doNotFake: ['setImmediate', 'nextTick'] });
    try {
      jest.setSystemTime(new Date('2026-10-20T15:00:00.000Z'));
      const { service } = arrange(
        teenRow({ birthday: new Date('2008-10-20T00:00:00.000Z') }),
      );
      expect((await errorOf(service.issueTeenGuardianLink(TEEN)))?.code).toBe(
        ErrorCode.PRINCIPAL_SCOPE_DENIED,
      );
      const stillMinor = arrange(
        teenRow({ birthday: new Date('2008-10-21T00:00:00.000Z') }),
      );
      await expect(
        stillMinor.service.issueTeenGuardianLink(TEEN),
      ).resolves.toBeDefined();
    } finally {
      jest.useRealTimers();
    }
  });

  it('a user without a birthday or without an account row is refused (cannot prove a minor)', async () => {
    expect(
      (
        await errorOf(
          arrange(teenRow({ birthday: null })).service.issueTeenGuardianLink(
            TEEN,
          ),
        )
      )?.code,
    ).toBe(ErrorCode.PRINCIPAL_SCOPE_DENIED);
    expect(
      (await errorOf(arrange(null).service.issueTeenGuardianLink(TEEN)))?.code,
    ).toBe(ErrorCode.PRINCIPAL_SCOPE_DENIED);
  });

  it('a frozen or purged teen gets no code (404)', async () => {
    const frozen = arrange(
      teenRow({
        dependent_profile: { frozen_at: new Date(), purged_at: null },
      }),
    );
    expect(
      (await errorOf(frozen.service.issueTeenGuardianLink(TEEN)))?.code,
    ).toBe(ErrorCode.GUARDIANSHIP_NOT_FOUND);
    const purged = arrange(
      teenRow({
        dependent_profile: { frozen_at: null, purged_at: new Date() },
      }),
    );
    expect(
      (await errorOf(purged.service.issueTeenGuardianLink(TEEN)))?.code,
    ).toBe(ErrorCode.GUARDIANSHIP_NOT_FOUND);
  });

  it('a teen who already has a guardian (even a pending link) gets 409 GUARDIANSHIP_ALREADY_GUARDIAN', async () => {
    const { service, tx } = arrange(teenRow(), 1);
    const error = await errorOf(service.issueTeenGuardianLink(TEEN));
    expect(error?.code).toBe(ErrorCode.GUARDIANSHIP_ALREADY_GUARDIAN);
    expect(error?.getStatus?.()).toBe(409);
    expect(tx.guardianship_link_codes.create).not.toHaveBeenCalled();
  });

  it('follows the country majority (16 makes a 16-year-old an adult)', async () => {
    const ctx = arrange(teenRow({ birthday: birthdayOf(16), country_id: 9 }));
    ctx.agePolicy.getPolicy.mockResolvedValue({
      minSelfLoginAge: 13,
      ageOfMajority: 16,
      timeZone: 'America/Mexico_City',
    });
    expect((await errorOf(ctx.service.issueTeenGuardianLink(TEEN)))?.code).toBe(
      ErrorCode.PRINCIPAL_SCOPE_DENIED,
    );
    expect(ctx.agePolicy.getPolicy).toHaveBeenCalledWith(9);
  });
});

describe('LinkCodesService.redeem: teen_guardian_link (phase 3a)', () => {
  const TEEN = DEPENDENT;
  const teenCode = codeRow({
    purpose: 'teen_guardian_link',
    issued_by_user_id: TEEN,
  });
  const birthdayOf = (years: number) => {
    const d = new Date();
    d.setUTCFullYear(d.getUTCFullYear() - years);
    d.setUTCDate(d.getUTCDate() - 5);
    return d;
  };
  const teenRow = (overrides: Record<string, unknown> = {}) => ({
    birthday: birthdayOf(15),
    country_id: null,
    dependent_profile: null,
    ...overrides,
  });

  function arrange(
    options: {
      teen?: unknown;
      alreadyGuardian?: boolean;
      activeGuardiansOfTeen?: number;
      redeemerDependents?: number;
    } = {},
  ) {
    const ctx = setup();
    ctx.tx.guardianship_link_codes.findFirst.mockResolvedValue(teenCode);
    ctx.tx.users.findFirst.mockResolvedValue(
      options.teen === undefined ? teenRow() : options.teen,
    );
    ctx.tx.guardianships.findFirst.mockResolvedValue(
      options.alreadyGuardian ? { guardianship_id: 'g-me' } : null,
    );
    // count(): first the teen's active guardians, then the redeemer's dependents.
    ctx.tx.guardianships.count
      .mockReset()
      .mockResolvedValueOnce(options.activeGuardiansOfTeen ?? 0)
      .mockResolvedValue(options.redeemerDependents ?? 0);
    return ctx;
  }

  it('creates the teen profile, a NON-custodian primary PENDING guardianship without inviter, and never verifies it', async () => {
    const { service, tx, created, actingForCache, guardianships } = arrange();

    const result = await service.redeem(REDEEMER, redeemDto());

    expect(tx.dependent_profiles.upsert).toHaveBeenCalledWith({
      where: { user_id: TEEN },
      update: {},
      create: { user_id: TEEN, created_by_user_id: TEEN },
    });
    expect(created).toEqual([
      expect.objectContaining({
        dependent_user_id: TEEN,
        guardian_user_id: REDEEMER,
        relationship_type_id: REL,
        is_primary: true,
        is_custodian: false,
        consent_status: 'pending',
        invited_by_guardianship_id: null,
        sworn_declaration_at: expect.any(Date),
      }),
    ]);
    expect(created[0]).not.toHaveProperty('verified_at');
    expect(created[0]).not.toHaveProperty('verification_method');
    expect(created[0]).not.toHaveProperty('verified_by_user_id');
    expect(actingForCache.bump).toHaveBeenCalledWith(TEEN);
    expect(guardianships.getSummaryForGuardian).toHaveBeenCalledWith(
      REDEEMER,
      TEEN,
    );
    expect(result).toEqual({ user_id: TEEN });
  });

  it('stops the guardian-less clock and records who linked (supervised_logins upsert)', async () => {
    const { service, tx } = arrange();
    await service.redeem(REDEEMER, redeemDto());

    const call = tx.supervised_logins.upsert.mock.calls[0][0];
    expect(call.where).toEqual({ user_id: TEEN });
    expect(call.update).toMatchObject({
      enabled_by_guardianship_id: 'gs-new',
      enabled_by_user_id: REDEEMER,
      enabled_at: expect.any(Date),
      pending_since: null,
      pending_reminder_level: 0,
    });
    expect(call.create).toMatchObject({
      user_id: TEEN,
      method: 'email',
      origin: 'self_registered',
      password_set_by: 'self',
      pending_since: null,
    });
  });

  it('asks the linked-device port to cut any device of the teen in the same transaction', async () => {
    const { service, tx, deviceRevoker } = arrange();
    await service.redeem(REDEEMER, redeemDto());
    expect(deviceRevoker.revokeAllForDependent).toHaveBeenCalledWith(
      tx,
      TEEN,
      'teen_login_enabled',
    );
  });

  it('hands club custody over like a director claim (custody revoked as claimed BEFORE the new primary)', async () => {
    const { service, tx } = arrange();
    await service.redeem(REDEEMER, redeemDto());

    expect(tx.guardianships.updateMany.mock.calls[0][0]).toEqual({
      where: {
        dependent_user_id: TEEN,
        guardian_user_id: null,
        consent_status: { not: 'revoked' },
      },
      data: {
        consent_status: 'revoked',
        revoked_at: expect.any(Date),
        revoked_reason: 'claimed',
        modified_at: expect.any(Date),
      },
    });
    expect(
      tx.guardianships.updateMany.mock.invocationCallOrder[0],
    ).toBeLessThan(tx.guardianships.create.mock.invocationCallOrder[0]);
  });

  it('locks the teen first and takes the redeemer create-lock for the 10-dependent cap', async () => {
    const { service, tx } = arrange();
    await service.redeem(REDEEMER, redeemDto());
    expect(tx.$executeRaw).toHaveBeenCalledTimes(2);
  });

  it('refuses a redeemer who is 17 or has no birthday before the code is touched (422, nothing consumed)', async () => {
    const { service, guardianships, committed, prisma } = arrange();
    guardianships.assertAdult.mockRejectedValue(
      Object.assign(new Error('x'), {
        code: ErrorCode.GUARDIANSHIP_GUARDIAN_NOT_ADULT,
      }),
    );
    expect((await errorOf(service.redeem(REDEEMER, redeemDto())))?.code).toBe(
      ErrorCode.GUARDIANSHIP_GUARDIAN_NOT_ADULT,
    );
    guardianships.assertAdult.mockRejectedValue(
      Object.assign(new Error('x'), {
        code: ErrorCode.GUARDIANSHIP_GUARDIAN_BIRTHDAY_REQUIRED,
      }),
    );
    expect((await errorOf(service.redeem(REDEEMER, redeemDto())))?.code).toBe(
      ErrorCode.GUARDIANSHIP_GUARDIAN_BIRTHDAY_REQUIRED,
    );
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(committed.codeConsumed).toBe(false);
  });

  it('refuses the teen redeeming their own code (403 SELF_REDEEM) without consuming it', async () => {
    const { service, committed } = arrange();
    const error = await errorOf(service.redeem(TEEN, redeemDto()));
    expect(error?.code).toBe(ErrorCode.GUARDIANSHIP_LINK_CODE_SELF_REDEEM);
    expect(committed.codeConsumed).toBe(false);
  });

  it('409 ALREADY_GUARDIAN when the redeemer already guards the teen; the code is not consumed', async () => {
    const { service, committed, failures } = arrange({ alreadyGuardian: true });
    const error = await errorOf(service.redeem(REDEEMER, redeemDto()));
    expect(error?.code).toBe(ErrorCode.GUARDIANSHIP_ALREADY_GUARDIAN);
    expect(error?.getStatus?.()).toBe(409);
    expect(committed.codeConsumed).toBe(false);
    expect(await failures.current(REDEEMER)).toBe(0);
  });

  it('409 DEPENDENT_LIMIT_REACHED at 10 dependents (teens count); the code is not consumed', async () => {
    const { service, committed, created } = arrange({ redeemerDependents: 10 });
    const error = await errorOf(service.redeem(REDEEMER, redeemDto()));
    expect(error?.code).toBe(ErrorCode.GUARDIANSHIP_DEPENDENT_LIMIT_REACHED);
    expect(committed.codeConsumed).toBe(false);
    expect(created).toHaveLength(0);
  });

  it.each([
    [
      'a frozen teen',
      teenRow({
        dependent_profile: { frozen_at: new Date(), purged_at: null },
      }),
    ],
    [
      'a purged teen',
      teenRow({
        dependent_profile: { frozen_at: null, purged_at: new Date() },
      }),
    ],
    ['a teen who turned 18 meanwhile', teenRow({ birthday: birthdayOf(19) })],
    ['a teen with no birthday', teenRow({ birthday: null })],
    ['a teen that is gone or has no account', null],
  ])(
    'is the uniform invalid code for %s, counts a failure and rolls back',
    async (_label, teen) => {
      const { service, committed, failures, created } = arrange({ teen });
      const error = await errorOf(service.redeem(REDEEMER, redeemDto()));
      expect(error?.code).toBe(ErrorCode.GUARDIANSHIP_LINK_CODE_INVALID);
      expect(error?.getStatus?.()).toBe(400);
      expect(committed.codeConsumed).toBe(false);
      expect(await failures.current(REDEEMER)).toBe(1);
      expect(created).toHaveLength(0);
    },
  );

  it('is invalid when somebody linked the teen first (already has an active user guardian)', async () => {
    const { service, committed, created } = arrange({
      activeGuardiansOfTeen: 1,
    });
    const error = await errorOf(service.redeem(REDEEMER, redeemDto()));
    expect(error?.code).toBe(ErrorCode.GUARDIANSHIP_LINK_CODE_INVALID);
    expect(committed.codeConsumed).toBe(false);
    expect(created).toHaveLength(0);
  });

  it('single use: the loser of a race gets the uniform 400', async () => {
    const { service, tx, created } = arrange();
    tx.guardianship_link_codes.updateMany.mockResolvedValue({ count: 0 });
    const error = await errorOf(service.redeem(REDEEMER, redeemDto()));
    expect(error?.code).toBe(ErrorCode.GUARDIANSHIP_LINK_CODE_INVALID);
    expect(created).toHaveLength(0);
  });

  it('the redeem result is the DependentSummary of the teen (access_mode comes from the summary service)', async () => {
    const { service, guardianships } = arrange();
    guardianships.getSummaryForGuardian.mockResolvedValue({
      user_id: TEEN,
      access_mode: 'supervised_login',
    });
    expect(await service.redeem(REDEEMER, redeemDto())).toEqual({
      user_id: TEEN,
      access_mode: 'supervised_login',
    });
  });
});

describe('LinkCodesService.redeem: purposes are isolated (phase 3a)', () => {
  it('a second_guardian code can be redeemed for a teen (account holder): the dependent lookup does not require "no account"', async () => {
    const { service, tx } = setup();
    tx.guardianships.findFirst
      .mockResolvedValueOnce({
        guardianship_id: 'g-inv',
        consent_status: 'verified',
      })
      .mockResolvedValueOnce(null);
    tx.guardianships.count.mockResolvedValue(1);

    await service.redeem(REDEEMER, redeemDto());

    const where = tx.users.findFirst.mock.calls[0][0].where;
    expect(where).not.toHaveProperty('account');
    expect(where.dependent_profile).toEqual({
      is: { frozen_at: null, purged_at: null },
    });
  });

  it('a director_claim code stays custodial-only (requires no account)', async () => {
    const { service, tx } = setup();
    tx.guardianship_link_codes.findFirst.mockResolvedValue(
      codeRow({
        purpose: 'director_claim',
        issued_by_user_id: DIRECTOR,
        issued_for_club_section_id: 5,
      }),
    );
    tx.guardianships.count.mockResolvedValue(0);

    await service.redeem(REDEEMER, redeemDto());

    expect(tx.users.findFirst.mock.calls[0][0].where.account).toEqual({
      none: {},
    });
  });

  it('a teen code never creates a second-guardian row on an unrelated dependent: it only ever builds a pending primary for the issuer', async () => {
    const ctx = setup();
    ctx.tx.guardianship_link_codes.findFirst.mockResolvedValue(
      codeRow({ purpose: 'teen_guardian_link', issued_by_user_id: DEPENDENT }),
    );
    ctx.tx.users.findFirst.mockResolvedValue({
      birthday: new Date('2011-01-01'),
      country_id: null,
      dependent_profile: null,
    });
    ctx.tx.guardianships.findFirst.mockResolvedValue(null);
    ctx.tx.guardianships.count.mockReset().mockResolvedValue(0);

    await ctx.service.redeem(REDEEMER, redeemDto());

    expect(ctx.created).toHaveLength(1);
    expect(ctx.created[0]).toMatchObject({
      dependent_user_id: DEPENDENT,
      is_primary: true,
      consent_status: 'pending',
    });
  });
});
