import { lockDependentsAscending } from '../guardianships/guardianship-queries';
import { lockActivationDependentsAscending } from './assignment-activation-gate';

const PREFIX = 'guardianships:dependent:';
const ADULT_BIRTHDAY = new Date('1990-01-01T00:00:00.000Z');

interface FakeUser {
  user_id: string;
  birthday: Date | null;
  country_id: number | null;
  dependent_profile: { user_id: string } | null;
}

/** `dependents` have a profile; `extras` are arbitrary extra user rows. */
function makeTx(dependents: string[] = [], extras: FakeUser[] = []) {
  const rows = (ids: string[]): FakeUser[] =>
    ids.map((id) => {
      const extra = extras.find((user) => user.user_id === id);
      if (extra) return extra;
      return {
        user_id: id,
        birthday: ADULT_BIRTHDAY,
        country_id: null,
        dependent_profile: dependents.includes(id) ? { user_id: id } : null,
      };
    });
  return {
    $executeRaw: jest.fn().mockResolvedValue(1),
    countries: {
      findUnique: jest.fn().mockResolvedValue({
        age_of_majority: 18,
        age_reference_timezone: 'America/Mexico_City',
      }),
    },
    users: {
      findMany: jest.fn((args: { where: { user_id: { in: string[] } } }) =>
        Promise.resolve(rows(args.where.user_id.in)),
      ),
    },
  };
}

function lockedIds(tx: ReturnType<typeof makeTx>): string[] {
  return tx.$executeRaw.mock.calls.map((call) =>
    String((call as unknown[])[1]).slice(PREFIX.length),
  );
}

describe('lockDependentsAscending', () => {
  it('locks each id once, in ascending order, whatever the input order', async () => {
    const tx = makeTx();

    const locked = await lockDependentsAscending(tx as never, [
      'dep-c',
      'dep-a',
      'dep-b',
      'dep-a',
    ]);

    expect(locked).toEqual(['dep-a', 'dep-b', 'dep-c']);
    expect(lockedIds(tx)).toEqual(['dep-a', 'dep-b', 'dep-c']);
  });

  it('takes no lock for an empty input', async () => {
    const tx = makeTx();
    await lockDependentsAscending(tx as never, []);
    expect(tx.$executeRaw).not.toHaveBeenCalled();
  });
});

describe('lockActivationDependentsAscending', () => {
  it('locks only the users that are minors, ascending', async () => {
    const tx = makeTx(['dep-z', 'dep-b']);

    const locked = await lockActivationDependentsAscending(tx as never, [
      'dep-z',
      'adult-1',
      'dep-b',
    ]);

    expect(locked).toEqual(['dep-b', 'dep-z']);
    expect(lockedIds(tx)).toEqual(['dep-b', 'dep-z']);
  });

  it('also locks minors by AGE (no dependent profile), in the same global order', async () => {
    const teenBirthday = new Date();
    teenBirthday.setUTCFullYear(teenBirthday.getUTCFullYear() - 16);
    const tx = makeTx(
      ['dep-m'],
      [
        {
          user_id: 'teen-a',
          birthday: teenBirthday,
          country_id: null,
          dependent_profile: null,
        },
      ],
    );

    const locked = await lockActivationDependentsAscending(tx as never, [
      'dep-m',
      'teen-a',
      'adult-1',
    ]);

    expect(locked).toEqual(['dep-m', 'teen-a']);
    expect(lockedIds(tx)).toEqual(['dep-m', 'teen-a']);
  });

  it('locks a user without a birthday (fail closed)', async () => {
    const tx = makeTx(
      [],
      [
        {
          user_id: 'unknown-age',
          birthday: null,
          country_id: null,
          dependent_profile: null,
        },
      ],
    );

    expect(
      await lockActivationDependentsAscending(tx as never, ['unknown-age']),
    ).toEqual(['unknown-age']);
  });

  it('reads each country policy once, whatever the number of users', async () => {
    const teenBirthday = new Date();
    teenBirthday.setUTCFullYear(teenBirthday.getUTCFullYear() - 16);
    const teen = (id: string): FakeUser => ({
      user_id: id,
      birthday: teenBirthday,
      country_id: 7,
      dependent_profile: null,
    });
    const tx = makeTx([], [teen('t-1'), teen('t-2'), teen('t-3')]);

    await lockActivationDependentsAscending(tx as never, ['t-1', 't-2', 't-3']);

    expect(tx.countries.findUnique).toHaveBeenCalledTimes(1);
  });

  it('uses the country majority (16 makes a 16-year-old an adult: no lock)', async () => {
    const birthday = new Date();
    birthday.setUTCFullYear(birthday.getUTCFullYear() - 17);
    const tx = makeTx(
      [],
      [{ user_id: 'u16', birthday, country_id: 9, dependent_profile: null }],
    );
    tx.countries.findUnique.mockResolvedValue({
      age_of_majority: 16,
      age_reference_timezone: 'America/Mexico_City',
    });

    expect(
      await lockActivationDependentsAscending(tx as never, ['u16']),
    ).toEqual([]);
    expect(tx.$executeRaw).not.toHaveBeenCalled();
  });

  it('does not even query for an empty input', async () => {
    const tx = makeTx();
    await lockActivationDependentsAscending(tx as never, []);
    expect(tx.users.findMany).not.toHaveBeenCalled();
    expect(tx.$executeRaw).not.toHaveBeenCalled();
  });
});
