import { calendarDateIn } from '../common/age/age.util';
import { DEFAULT_COUNTRY_AGE_POLICY } from '../common/age/country-age-policy.service';
import { ErrorCode } from '../common/errors/error-codes';
import { LegalService } from '../legal/legal.service';
import { GuardianshipsService } from './guardianships.service';

const TZ = DEFAULT_COUNTRY_AGE_POLICY.timeZone;
const CURRENT = '1.0.0-store';
const GUARDIAN = '11111111-1111-4111-8111-111111111111';
const REL_TYPE = '22222222-2222-4222-8222-222222222222';

/** YYYY-MM-DD for "someone who is `years` old today, shifted by `days`". */
function birthday(years: number, days = 0): string {
  const today = calendarDateIn(TZ);
  const date = new Date(
    Date.UTC(
      today.getUTCFullYear() - years,
      today.getUTCMonth(),
      today.getUTCDate() + days,
    ),
  );
  return date.toISOString().slice(0, 10);
}

const dto = (overrides: Record<string, unknown> = {}) =>
  ({
    name: 'Ana',
    paternal_last_name: 'Pérez',
    maternal_last_name: 'López',
    birthday: birthday(9),
    relationship_type_id: REL_TYPE,
    sworn_declaration: true,
    accepted_terms_version: CURRENT,
    accepted_privacy_version: CURRENT,
    ...overrides,
  }) as any;

function summaryRow(dependentId: string) {
  return {
    guardianship_id: 'g-1',
    dependent_user_id: dependentId,
    is_primary: true,
    consent_status: 'pending',
    verified_at: null,
    relationship_type: { relationship_type_id: REL_TYPE, name: 'Madre' },
    consent_evidences: [],
    dependent: {
      user_id: dependentId,
      name: 'Ana',
      paternal_last_name: 'Pérez',
      maternal_last_name: 'López',
      birthday: new Date(`${birthday(9)}T00:00:00.000Z`),
      user_image: null,
      country_id: null,
      users_pr: { complete: false },
      dependent_profile: { frozen_at: null },
    },
  };
}

function setup(options: { guardianBirthday?: string | null } = {}) {
  const guardianBirthday =
    options.guardianBirthday === undefined
      ? birthday(35)
      : options.guardianBirthday;

  const calls: string[] = [];
  const tx = {
    $queryRaw: jest.fn().mockResolvedValue([]),
    guardianships: {
      count: jest.fn().mockResolvedValue(0),
      create: jest.fn().mockResolvedValue({}),
    },
    roles: {
      findFirst: jest.fn().mockResolvedValue({ role_id: 'role-user' }),
    },
    users: { create: jest.fn().mockResolvedValue({}) },
    users_pr: { create: jest.fn().mockResolvedValue({}) },
    users_roles: { create: jest.fn().mockResolvedValue({}) },
    dependent_profiles: { create: jest.fn().mockResolvedValue({}) },
    legal_acceptances: {
      createMany: jest.fn().mockResolvedValue({ count: 2 }),
    },
  };
  let committed = false;
  const prisma = {
    users: {
      findUnique: jest.fn().mockResolvedValue(
        guardianBirthday === null
          ? { birthday: null, country_id: null }
          : {
              birthday: new Date(`${guardianBirthday}T00:00:00.000Z`),
              country_id: null,
            },
      ),
    },
    relationship_types: {
      findFirst: jest
        .fn()
        .mockResolvedValue({ relationship_type_id: REL_TYPE }),
    },
    guardianships: {
      findFirst: jest.fn(),
      findMany: jest.fn().mockResolvedValue([]),
    },
    club_role_assignments: { findMany: jest.fn().mockResolvedValue([]) },
    $transaction: jest.fn(async (callback: (t: typeof tx) => unknown) => {
      const result = await callback(tx);
      committed = true;
      calls.push('commit');
      return result;
    }),
  };
  const policy = {
    getPolicy: jest.fn().mockResolvedValue({ ...DEFAULT_COUNTRY_AGE_POLICY }),
  };
  const cache = {
    bump: jest.fn().mockImplementation(async () => {
      calls.push(committed ? 'bump-after-commit' : 'bump-before-commit');
    }),
  };
  const legal = new LegalService(prisma as any);
  const service = new GuardianshipsService(
    prisma as any,
    policy as any,
    legal,
    cache as any,
  );
  // After create, the service reads the summary back through the guardian row.
  prisma.guardianships.findFirst.mockImplementation(async () =>
    summaryRow(
      (tx.users.create.mock.calls[0]?.[0]?.data?.user_id as string) ?? 'x',
    ),
  );
  return { service, prisma, tx, policy, cache, calls };
}

async function codeOf(promise: Promise<unknown>) {
  try {
    await promise;
  } catch (error) {
    return (error as { code?: string }).code;
  }
  return undefined;
}

describe('GuardianshipsService.createDependent', () => {
  it('creates the user, profile, primary pending guardianship and legal acceptance in ONE transaction', async () => {
    const { service, prisma, tx, cache, calls } = setup();

    const result = await service.createDependent(GUARDIAN, dto(), {
      ipAddress: '203.0.113.9',
      userAgent: 'SACDIA/1.0',
    });

    expect(prisma.$transaction).toHaveBeenCalledTimes(1);

    const created = tx.users.create.mock.calls[0][0].data;
    expect(created).toMatchObject({
      email: null,
      name: 'Ana',
      paternal_last_name: 'Pérez',
      maternal_last_name: 'López',
      country_id: null,
    });
    expect(created.user_id).toMatch(/^[0-9a-f-]{36}$/);
    const dependentId = created.user_id as string;

    expect(tx.users_pr.create).toHaveBeenCalledWith({
      data: {
        user_id: dependentId,
        complete: false,
        profile_picture_complete: false,
        personal_info_complete: false,
        club_selection_complete: false,
      },
    });
    expect(tx.users_roles.create).toHaveBeenCalledWith({
      data: { user_id: dependentId, role_id: 'role-user' },
    });
    expect(tx.dependent_profiles.create).toHaveBeenCalledWith({
      data: { user_id: dependentId, created_by_user_id: GUARDIAN },
    });
    expect(tx.guardianships.create).toHaveBeenCalledWith({
      data: {
        dependent_user_id: dependentId,
        guardian_user_id: GUARDIAN,
        relationship_type_id: REL_TYPE,
        is_primary: true,
        consent_status: 'pending',
        sworn_declaration_at: expect.any(Date),
      },
    });

    // accepted_by_user_id = guardian, subject = dependent
    const legalRows = tx.legal_acceptances.createMany.mock.calls[0][0].data;
    expect(legalRows).toHaveLength(2);
    for (const row of legalRows) {
      expect(row).toMatchObject({
        user_id: dependentId,
        accepted_by_user_id: GUARDIAN,
        method: 'register_checkbox',
        document_version: CURRENT,
        ip_address: '203.0.113.9',
      });
    }

    // The epoch moves only after the transaction committed.
    expect(cache.bump).toHaveBeenCalledWith(dependentId);
    expect(calls).toEqual(['commit', 'bump-after-commit']);

    expect(result).toMatchObject({
      user_id: dependentId,
      access_mode: 'guardian_managed',
      post_register_complete: false,
      frozen: false,
      age: 9,
      club_membership: null,
      guardianship: {
        is_primary: true,
        consent_status: 'pending',
        evidence_uploaded: false,
      },
    });
  });

  it('serializes concurrent creates of one guardian with an advisory lock', async () => {
    const { service, tx } = setup();
    await service.createDependent(GUARDIAN, dto());
    expect(tx.$queryRaw).toHaveBeenCalledTimes(1);
  });

  it('inherits the guardian country on the dependent', async () => {
    const { service, prisma, tx } = setup();
    prisma.users.findUnique.mockResolvedValue({
      birthday: new Date(`${birthday(35)}T00:00:00.000Z`),
      country_id: 7,
    });
    await service.createDependent(GUARDIAN, dto());
    expect(tx.users.create.mock.calls[0][0].data.country_id).toBe(7);
  });

  describe('dependent age bounds (guardian country policy)', () => {
    it('allows a child turning 13 tomorrow', async () => {
      const { service, tx } = setup();
      await service.createDependent(
        GUARDIAN,
        dto({ birthday: birthday(13, 1) }),
      );
      expect(tx.users.create).toHaveBeenCalled();
    });

    it('rejects a child who is exactly 13 today', async () => {
      const { service, tx } = setup();
      expect(
        await codeOf(
          service.createDependent(GUARDIAN, dto({ birthday: birthday(13) })),
        ),
      ).toBe(ErrorCode.GUARDIANSHIP_DEPENDENT_AGE_OUT_OF_RANGE);
      expect(tx.users.create).not.toHaveBeenCalled();
    });

    it('rejects future and impossible dates', async () => {
      const { service } = setup();
      expect(
        await codeOf(
          service.createDependent(GUARDIAN, dto({ birthday: birthday(0, 2) })),
        ),
      ).toBe(ErrorCode.GUARDIANSHIP_DEPENDENT_AGE_OUT_OF_RANGE);
      expect(
        await codeOf(
          service.createDependent(GUARDIAN, dto({ birthday: '2017-02-30' })),
        ),
      ).toBe(ErrorCode.GUARDIANSHIP_DEPENDENT_AGE_OUT_OF_RANGE);
    });

    it('uses the country cutoff: 14 is fine under 13 but not under 16', async () => {
      const { service, policy } = setup();
      await expect(
        service.createDependent(GUARDIAN, dto({ birthday: birthday(14) })),
      ).rejects.toBeDefined();

      policy.getPolicy.mockResolvedValue({
        minSelfLoginAge: 16,
        ageOfMajority: 18,
        timeZone: TZ,
      });
      await expect(
        service.createDependent(GUARDIAN, dto({ birthday: birthday(14) })),
      ).resolves.toBeDefined();
    });
  });

  describe('guardian eligibility', () => {
    it('requires a guardian birthday', async () => {
      const { service, tx } = setup({ guardianBirthday: null });
      expect(await codeOf(service.createDependent(GUARDIAN, dto()))).toBe(
        ErrorCode.GUARDIANSHIP_GUARDIAN_BIRTHDAY_REQUIRED,
      );
      expect(tx.users.create).not.toHaveBeenCalled();
    });

    it('rejects a 17 year old guardian and accepts an 18 year old', async () => {
      const minor = setup({ guardianBirthday: birthday(17) });
      expect(await codeOf(minor.service.createDependent(GUARDIAN, dto()))).toBe(
        ErrorCode.GUARDIANSHIP_GUARDIAN_NOT_ADULT,
      );
      const adult = setup({ guardianBirthday: birthday(18) });
      await expect(
        adult.service.createDependent(GUARDIAN, dto()),
      ).resolves.toBeDefined();
    });
  });

  describe('limits', () => {
    it('refuses the 11th active dependent with 409', async () => {
      const { service, tx, cache } = setup();
      tx.guardianships.count.mockResolvedValue(10);
      expect(await codeOf(service.createDependent(GUARDIAN, dto()))).toBe(
        ErrorCode.GUARDIANSHIP_DEPENDENT_LIMIT_REACHED,
      );
      expect(tx.users.create).not.toHaveBeenCalled();
      expect(cache.bump).not.toHaveBeenCalled();
    });

    it('does not count revoked, frozen or purged dependents', async () => {
      const { service, tx } = setup();
      await service.createDependent(GUARDIAN, dto());
      expect(tx.guardianships.count).toHaveBeenCalledWith({
        where: {
          guardian_user_id: GUARDIAN,
          is_custodian: false,
          consent_status: { not: 'revoked' },
          dependent: {
            dependent_profile: { is: { frozen_at: null, purged_at: null } },
          },
        },
      });
    });
  });

  describe('failure handling', () => {
    it('rolls back (and never bumps the epoch) when the legal acceptance fails', async () => {
      const { service, tx, cache } = setup();
      tx.legal_acceptances.createMany.mockRejectedValue(new Error('db down'));
      await expect(service.createDependent(GUARDIAN, dto())).rejects.toThrow(
        'db down',
      );
      expect(cache.bump).not.toHaveBeenCalled();
    });

    it('rejects stale legal versions before touching the database', async () => {
      const { service, prisma } = setup();
      expect(
        await codeOf(
          service.createDependent(
            GUARDIAN,
            dto({ accepted_terms_version: '0.9.0' }),
          ),
        ),
      ).toBe(ErrorCode.LEGAL_VERSION_MISMATCH);
      expect(prisma.users.findUnique).not.toHaveBeenCalled();
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('rejects an unknown or inactive relationship type with 400', async () => {
      const { service, prisma } = setup();
      prisma.relationship_types.findFirst.mockResolvedValue(null);
      expect(await codeOf(service.createDependent(GUARDIAN, dto()))).toBe(
        ErrorCode.GUARDIANSHIP_RELATIONSHIP_TYPE_INVALID,
      );
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });
  });
});

describe('GuardianshipsService reads', () => {
  it('lists visible dependents with the limit and a batched club membership query', async () => {
    const { service, prisma } = setup();
    prisma.guardianships.findMany.mockResolvedValue([
      summaryRow('d-1'),
      summaryRow('d-2'),
    ]);
    prisma.club_role_assignments.findMany.mockResolvedValue([
      {
        assignment_id: 'a-old',
        user_id: 'd-1',
        status: 'rejected',
        club_section_id: 3,
        club_sections: {
          clubs: { name: 'Viejo' },
          club_types: { name: 'Aventureros' },
        },
      },
      {
        assignment_id: 'a-live',
        user_id: 'd-1',
        status: 'pending',
        club_section_id: 12,
        club_sections: {
          clubs: { name: 'Central' },
          club_types: { name: 'Conquistadores' },
        },
      },
    ]);

    const result = await service.listForGuardian(GUARDIAN);

    expect(prisma.club_role_assignments.findMany).toHaveBeenCalledTimes(1);
    expect(prisma.guardianships.findMany.mock.calls[0][0].where).toMatchObject({
      guardian_user_id: GUARDIAN,
      is_custodian: false,
      is_test_data: false,
      consent_status: { not: 'revoked' },
      dependent: {
        dependent_profile: { is: { frozen_at: null, purged_at: null } },
      },
    });
    expect(result.limits).toEqual({ max_dependents: 10 });
    expect(result.dependents).toHaveLength(2);
    expect(result.dependents[0].club_membership).toEqual({
      assignment_id: 'a-live',
      status: 'pending',
      club_section_id: 12,
      club_name: 'Central',
      club_type_name: 'Conquistadores',
    });
    expect(result.dependents[1].club_membership).toBeNull();
  });

  it('flags evidence_uploaded and frozen in the summary', async () => {
    const { service, prisma } = setup();
    const row = summaryRow('d-1');
    row.consent_evidences = [{ evidence_id: 'e-1' }] as never;
    row.dependent.dependent_profile = { frozen_at: new Date() } as never;
    prisma.guardianships.findMany.mockResolvedValue([row]);

    const [summary] = (await service.listForGuardian(GUARDIAN)).dependents;
    expect(summary.guardianship.evidence_uploaded).toBe(true);
    expect(summary.frozen).toBe(true);
  });

  it('returns 404 GUARDIANSHIP_NOT_FOUND for a stranger asking for a detail', async () => {
    const { service, prisma } = setup();
    prisma.guardianships.findFirst.mockResolvedValue(null);
    expect(await codeOf(service.getDetailForGuardian(GUARDIAN, 'd-9'))).toBe(
      ErrorCode.GUARDIANSHIP_NOT_FOUND,
    );
  });

  it('builds the guardian list of a detail, marking me and the club custodian', async () => {
    const { service, prisma } = setup();
    prisma.guardianships.findFirst.mockResolvedValue(summaryRow('d-1'));
    prisma.guardianships.findMany.mockResolvedValue([
      {
        guardianship_id: 'g-1',
        guardian_user_id: GUARDIAN,
        is_primary: true,
        is_custodian: false,
        consent_status: 'pending',
        external_name: null,
        relationship_type: { name: 'Madre' },
        guardian: { name: 'María', paternal_last_name: 'Pérez' },
        custodian_club: null,
      },
      {
        guardianship_id: 'g-2',
        guardian_user_id: null,
        is_primary: false,
        is_custodian: true,
        consent_status: 'verified',
        external_name: null,
        relationship_type: null,
        guardian: null,
        custodian_club: { name: 'Club Central' },
      },
    ]);

    const detail = await service.getDetailForGuardian(GUARDIAN, 'd-1');

    expect(detail.guardians).toEqual([
      {
        guardianship_id: 'g-1',
        user_id: GUARDIAN,
        display_name: 'María Pérez',
        relationship_type_name: 'Madre',
        is_primary: true,
        is_custodian: false,
        consent_status: 'pending',
        is_me: true,
      },
      {
        guardianship_id: 'g-2',
        user_id: null,
        display_name: 'Club Central',
        relationship_type_name: null,
        is_primary: false,
        is_custodian: true,
        consent_status: 'verified',
        is_me: false,
      },
    ]);
  });
});
