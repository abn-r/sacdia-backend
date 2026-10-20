import { ErrorCode } from '../common/errors/error-codes';
import {
  assertAssignmentActivationAllowed,
  isAssignmentActivationAllowed,
  isMinorForActivationRow,
} from './assignment-activation-gate';

const USER_ID = '20a9a762-a4fa-49dd-93a6-3851e27f8b69';
const NOW = new Date('2026-10-20T15:00:00.000Z');
const date = (value: string) => new Date(`${value}T00:00:00.000Z`);

interface UserRow {
  birthday: Date | null;
  country_id: number | null;
  dependent_profile: { user_id: string } | null;
}

function makeTx(user: UserRow | null, verified: boolean) {
  const order: string[] = [];
  const tx = {
    order,
    $executeRaw: jest.fn((sql: TemplateStringsArray) => {
      order.push(`lock:${sql.join('?')}`);
      return Promise.resolve(1);
    }),
    users: {
      findUnique: jest.fn().mockResolvedValue(user),
    },
    countries: {
      findUnique: jest.fn().mockResolvedValue({
        age_of_majority: 18,
        age_reference_timezone: 'America/Mexico_City',
      }),
    },
    guardianships: {
      findFirst: jest.fn(() => {
        order.push('read');
        return Promise.resolve(verified ? { guardianship_id: 'g1' } : null);
      }),
    },
  };
  return tx;
}

const teen = (years: number, overrides: Partial<UserRow> = {}): UserRow => {
  const birthday = new Date(NOW);
  birthday.setUTCFullYear(birthday.getUTCFullYear() - years);
  birthday.setUTCDate(birthday.getUTCDate() - 3);
  return {
    birthday,
    country_id: null,
    dependent_profile: null,
    ...overrides,
  };
};

describe('isMinorForActivationRow', () => {
  const policy = { ageOfMajority: 18, timeZone: 'America/Mexico_City' };

  it('is a minor with a dependent profile whatever the age', () => {
    expect(
      isMinorForActivationRow(
        { birthday: date('1980-01-01'), hasDependentProfile: true },
        policy,
        NOW,
      ),
    ).toBe(true);
  });

  it('is a minor without a birthday (fail closed)', () => {
    expect(
      isMinorForActivationRow(
        { birthday: null, hasDependentProfile: false },
        policy,
        NOW,
      ),
    ).toBe(true);
  });

  it.each([
    ['17 years and 364 days', '2008-10-21', true],
    ['exactly 18 today', '2008-10-20', false],
    ['an adult of 30', '1996-03-01', false],
  ])('%s', (_label, birthday, minor) => {
    expect(
      isMinorForActivationRow(
        { birthday: date(birthday), hasDependentProfile: false },
        policy,
        NOW,
      ),
    ).toBe(minor);
  });

  it('turns 18 at the country midnight, not at UTC midnight', () => {
    // 2026-10-21T04:00Z is still 2026-10-20 22:00 in Mexico City.
    expect(
      isMinorForActivationRow(
        { birthday: date('2008-10-21'), hasDependentProfile: false },
        policy,
        new Date('2026-10-21T04:00:00.000Z'),
      ),
    ).toBe(true);
    expect(
      isMinorForActivationRow(
        { birthday: date('2008-10-21'), hasDependentProfile: false },
        policy,
        new Date('2026-10-21T07:00:00.000Z'),
      ),
    ).toBe(false);
  });

  it('follows a majority of 16', () => {
    expect(
      isMinorForActivationRow(
        { birthday: date('2010-05-05'), hasDependentProfile: false },
        { ageOfMajority: 16, timeZone: 'America/Mexico_City' },
        NOW,
      ),
    ).toBe(false);
  });
});

describe('isAssignmentActivationAllowed / assertAssignmentActivationAllowed', () => {
  it('blocks a self-registered 15-year-old with no guardianship (409 MR_CONSENT_NOT_VERIFIED)', async () => {
    const tx = makeTx(teen(15), false);

    expect(await isAssignmentActivationAllowed(tx as never, USER_ID)).toBe(
      false,
    );
    await expect(
      assertAssignmentActivationAllowed(tx as never, USER_ID),
    ).rejects.toMatchObject({
      code: ErrorCode.MR_CONSENT_NOT_VERIFIED,
      status: 409,
    });
  });

  it('allows a 15-year-old once a verified, non-test row exists (custody counts)', async () => {
    const tx = makeTx(teen(15), true);

    expect(await isAssignmentActivationAllowed(tx as never, USER_ID)).toBe(
      true,
    );
    expect(tx.guardianships.findFirst).toHaveBeenCalledWith({
      where: {
        dependent_user_id: USER_ID,
        consent_status: 'verified',
        is_test_data: false,
      },
      select: { guardianship_id: true },
    });
  });

  it('only counts verified rows: a revoked or test-only history leaves the gate closed', async () => {
    const tx = makeTx(teen(15), false);
    await expect(
      assertAssignmentActivationAllowed(tx as never, USER_ID),
    ).rejects.toMatchObject({ code: ErrorCode.MR_CONSENT_NOT_VERIFIED });
    // The query itself excludes test data and anything not verified (a revoked
    // row can never be 'verified', DB check guardianships_revoked_ck).
    const where = tx.guardianships.findFirst.mock.calls[0][0] as unknown as {
      where: Record<string, unknown>;
    };
    expect(where.where).toMatchObject({
      consent_status: 'verified',
      is_test_data: false,
    });
  });

  it('does not touch adults: no lock, no guardianship lookup', async () => {
    const tx = makeTx(teen(18), false);

    expect(await isAssignmentActivationAllowed(tx as never, USER_ID)).toBe(
      true,
    );
    expect(tx.$executeRaw).not.toHaveBeenCalled();
    expect(tx.guardianships.findFirst).not.toHaveBeenCalled();
  });

  it('does not touch a 16-year-old of a country whose majority is 16', async () => {
    const tx = makeTx(teen(16, { country_id: 9 }), false);
    tx.countries.findUnique.mockResolvedValue({
      age_of_majority: 16,
      age_reference_timezone: 'America/Mexico_City',
    });

    expect(await isAssignmentActivationAllowed(tx as never, USER_ID)).toBe(
      true,
    );
    expect(tx.countries.findUnique).toHaveBeenCalledWith({
      where: { country_id: 9 },
      select: { age_of_majority: true, age_reference_timezone: true },
    });
    expect(tx.$executeRaw).not.toHaveBeenCalled();
  });

  it('falls back to the defaults for a country without a row', async () => {
    const tx = makeTx(teen(15, { country_id: 404 }), false);
    tx.countries.findUnique.mockResolvedValue(null);

    expect(await isAssignmentActivationAllowed(tx as never, USER_ID)).toBe(
      false,
    );
  });

  it('fails closed for a NULL birthday (409), and works once an adult birthday is set', async () => {
    const unknown = makeTx(
      { birthday: null, country_id: null, dependent_profile: null },
      false,
    );
    await expect(
      assertAssignmentActivationAllowed(unknown as never, USER_ID),
    ).rejects.toMatchObject({ code: ErrorCode.MR_CONSENT_NOT_VERIFIED });

    const nowAdult = makeTx(teen(30), false);
    await expect(
      assertAssignmentActivationAllowed(nowAdult as never, USER_ID),
    ).resolves.toBeUndefined();
  });

  it('keeps gating a dependent with a profile whatever the birthday says', async () => {
    const tx = makeTx(
      teen(40, { dependent_profile: { user_id: USER_ID } }),
      false,
    );
    expect(await isAssignmentActivationAllowed(tx as never, USER_ID)).toBe(
      false,
    );
  });

  it('takes the per-dependent advisory lock BEFORE re-reading the consent (revoked between listing and approve)', async () => {
    const tx = makeTx(teen(15), true);

    await isAssignmentActivationAllowed(tx as never, USER_ID);

    expect(tx.order).toEqual([
      'lock:SELECT pg_advisory_xact_lock(hashtext(?))',
      'read',
    ]);
  });

  it('a user that does not exist is not gated (the caller FK fails on its own)', async () => {
    const tx = makeTx(null, false);
    expect(await isAssignmentActivationAllowed(tx as never, USER_ID)).toBe(
      true,
    );
  });

  it('the turns-18 boundary: a teen is gated until the country calendar day changes', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-10-21T04:00:00.000Z'));
    try {
      const before = makeTx(
        {
          birthday: date('2008-10-21'),
          country_id: null,
          dependent_profile: null,
        },
        false,
      );
      expect(
        await isAssignmentActivationAllowed(before as never, USER_ID),
      ).toBe(false);

      jest.setSystemTime(new Date('2026-10-21T07:00:00.000Z'));
      const after = makeTx(
        {
          birthday: date('2008-10-21'),
          country_id: null,
          dependent_profile: null,
        },
        false,
      );
      expect(await isAssignmentActivationAllowed(after as never, USER_ID)).toBe(
        true,
      );
    } finally {
      jest.useRealTimers();
    }
  });
});
