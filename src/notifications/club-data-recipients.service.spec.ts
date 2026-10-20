import { DEFAULT_COUNTRY_AGE_POLICY } from '../common/age/country-age-policy.service';
import { ClubDataRecipientsService } from './club-data-recipients.service';

const ADULT = 'aaaaaaaa-0000-4000-8000-000000000001';
const ACTIVE_TEEN = 'aaaaaaaa-0000-4000-8000-000000000002';
const PENDING_TEEN = 'aaaaaaaa-0000-4000-8000-000000000003';
const UNKNOWN_AGE = 'aaaaaaaa-0000-4000-8000-000000000004';
const LEGACY_NO_BIRTHDAY = 'aaaaaaaa-0000-4000-8000-000000000005';
const STAFF_NO_BIRTHDAY = 'aaaaaaaa-0000-4000-8000-000000000006';
const PLAIN_DEPENDENT = 'aaaaaaaa-0000-4000-8000-000000000007';
const HANDLE_TEEN = 'aaaaaaaa-0000-4000-8000-000000000008';
const UNKNOWN_USER = 'aaaaaaaa-0000-4000-8000-000000000009';

const NOW = new Date();
const yearsAgo = (years: number) =>
  new Date(Date.UTC(NOW.getUTCFullYear() - years, 5, 15));

interface Row {
  user_id: string;
  birthday: Date | null;
  country_id?: number | null;
  verifiedGuardian?: boolean;
  account?: boolean;
  supervisedLogin?: { disabled_at: Date | null; method: string } | null;
  postRegistrationComplete?: boolean | null;
  staffRole?: boolean;
}

function row(r: Row) {
  return {
    user_id: r.user_id,
    birthday: r.birthday,
    country_id: r.country_id ?? null,
    supervised_login: r.supervisedLogin ?? null,
    dependent_profile: null,
    guardianships_as_dependent: r.verifiedGuardian
      ? [{ guardianship_id: 'g-1' }]
      : [],
    access_panel: false,
    users_pr:
      r.postRegistrationComplete === null ||
      r.postRegistrationComplete === undefined
        ? null
        : { complete: r.postRegistrationComplete },
    users_roles: r.staffRole ? [{ user_role_id: 'ur-1' }] : [],
    account: r.account === false ? [] : [{ id: 'acc-1' }],
  };
}

function setup(rows: ReturnType<typeof row>[]) {
  const prisma: any = {
    users: { findMany: jest.fn().mockResolvedValue(rows) },
  };
  const countryAgePolicy: any = {
    getPolicy: jest.fn().mockResolvedValue({ ...DEFAULT_COUNTRY_AGE_POLICY }),
  };
  return {
    service: new ClubDataRecipientsService(prisma, countryAgePolicy),
    prisma,
    countryAgePolicy,
  };
}

describe('ClubDataRecipientsService.filterClubDataRecipients', () => {
  it('drops a pending teen but keeps an active teen and an adult', async () => {
    const { service } = setup([
      row({ user_id: ADULT, birthday: yearsAgo(30) }),
      row({
        user_id: ACTIVE_TEEN,
        birthday: yearsAgo(15),
        verifiedGuardian: true,
      }),
      row({ user_id: PENDING_TEEN, birthday: yearsAgo(15) }),
    ]);

    await expect(
      service.filterClubDataRecipients([ADULT, ACTIVE_TEEN, PENDING_TEEN]),
    ).resolves.toEqual([ADULT, ACTIVE_TEEN]);
  });

  it('reads every recipient with ONE users query, however many there are', async () => {
    const { service, prisma } = setup([
      row({ user_id: ADULT, birthday: yearsAgo(30) }),
      row({ user_id: PENDING_TEEN, birthday: yearsAgo(15) }),
      row({ user_id: ACTIVE_TEEN, birthday: yearsAgo(15) }),
    ]);

    await service.filterClubDataRecipients([
      ADULT,
      PENDING_TEEN,
      ACTIVE_TEEN,
      ADULT,
    ]);

    expect(prisma.users.findMany).toHaveBeenCalledTimes(1);
    expect(prisma.users.findMany.mock.calls[0][0].where).toEqual({
      user_id: { in: [ADULT, PENDING_TEEN, ACTIVE_TEEN] },
    });
  });

  it('asks for the verified, non-test, non-custodian, non-revoked guardianship the principal resolver asks for', async () => {
    const { service, prisma } = setup([]);
    await service.filterClubDataRecipients([ADULT]);

    expect(
      prisma.users.findMany.mock.calls[0][0].select.guardianships_as_dependent
        .where,
    ).toEqual({
      consent_status: 'verified',
      is_test_data: false,
      is_custodian: false,
      revoked_at: null,
    });
  });

  it('applies the age policy of the recipient country', async () => {
    const { service, countryAgePolicy } = setup([
      row({ user_id: PENDING_TEEN, birthday: yearsAgo(19), country_id: 7 }),
      row({ user_id: ADULT, birthday: yearsAgo(19), country_id: 8 }),
    ]);
    // Country 7 has a majority age of 21: the 19-year-old is a minor there.
    countryAgePolicy.getPolicy.mockImplementation(async (id: number) =>
      id === 7
        ? { ...DEFAULT_COUNTRY_AGE_POLICY, ageOfMajority: 21 }
        : { ...DEFAULT_COUNTRY_AGE_POLICY },
    );

    await expect(
      service.filterClubDataRecipients([PENDING_TEEN, ADULT]),
    ).resolves.toEqual([ADULT]);
    expect(countryAgePolicy.getPolicy).toHaveBeenCalledTimes(2);
  });

  it('looks up one policy per distinct country, not per recipient', async () => {
    const { service, countryAgePolicy } = setup([
      row({ user_id: ADULT, birthday: yearsAgo(30), country_id: 1 }),
      row({ user_id: PENDING_TEEN, birthday: yearsAgo(15), country_id: 1 }),
      row({ user_id: ACTIVE_TEEN, birthday: yearsAgo(15), country_id: 1 }),
    ]);

    await service.filterClubDataRecipients([ADULT, PENDING_TEEN, ACTIVE_TEEN]);

    expect(countryAgePolicy.getPolicy).toHaveBeenCalledTimes(1);
  });

  it('drops an unknown-age account (no birthday, post-registration open, not staff)', async () => {
    const { service } = setup([
      row({
        user_id: UNKNOWN_AGE,
        birthday: null,
        postRegistrationComplete: false,
      }),
    ]);

    await expect(
      service.filterClubDataRecipients([UNKNOWN_AGE]),
    ).resolves.toEqual([]);
  });

  it('keeps a no-birthday account that is a legacy row or staff', async () => {
    const { service } = setup([
      // Admin-created / seeded: no post-registration row at all.
      row({ user_id: LEGACY_NO_BIRTHDAY, birthday: null }),
      // Open post-registration but a global staff role.
      row({
        user_id: STAFF_NO_BIRTHDAY,
        birthday: null,
        postRegistrationComplete: false,
        staffRole: true,
      }),
    ]);

    await expect(
      service.filterClubDataRecipients([LEGACY_NO_BIRTHDAY, STAFF_NO_BIRTHDAY]),
    ).resolves.toEqual([LEGACY_NO_BIRTHDAY, STAFF_NO_BIRTHDAY]);
  });

  it('drops a pending teen that holds a supervised login (handle) too', async () => {
    const { service } = setup([
      row({
        user_id: HANDLE_TEEN,
        birthday: yearsAgo(14),
        account: false,
        supervisedLogin: { disabled_at: null, method: 'handle' },
      }),
    ]);

    await expect(
      service.filterClubDataRecipients([HANDLE_TEEN]),
    ).resolves.toEqual([]);
  });

  it('never drops a plain dependent (no account): its notices reach it through the guardian fan-out', async () => {
    const { service } = setup([
      row({
        user_id: PLAIN_DEPENDENT,
        birthday: yearsAgo(9),
        account: false,
      }),
    ]);

    await expect(
      service.filterClubDataRecipients([PLAIN_DEPENDENT]),
    ).resolves.toEqual([PLAIN_DEPENDENT]);
  });

  it('keeps a user that has no row (never invents a restriction)', async () => {
    const { service } = setup([]);

    await expect(
      service.filterClubDataRecipients([UNKNOWN_USER]),
    ).resolves.toEqual([UNKNOWN_USER]);
  });

  it('does not query for an empty list', async () => {
    const { service, prisma } = setup([]);

    await expect(service.filterClubDataRecipients([])).resolves.toEqual([]);
    expect(prisma.users.findMany).not.toHaveBeenCalled();
  });

  it('fails closed: a database error propagates instead of letting everyone through', async () => {
    const { service, prisma } = setup([]);
    prisma.users.findMany.mockRejectedValue(new Error('db down'));

    await expect(service.filterClubDataRecipients([ADULT])).rejects.toThrow(
      'db down',
    );
  });
});
