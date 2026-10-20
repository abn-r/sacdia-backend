import { calendarDateIn } from '../common/age/age.util';
import { DEFAULT_COUNTRY_AGE_POLICY } from '../common/age/country-age-policy.service';
import { ErrorCode } from '../common/errors/error-codes';
import { LegalService } from '../legal/legal.service';
import { GUARDIAN_RELATIONSHIP_TYPE_NAMES } from './guardianships.constants';
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
    dependent: {
      guardianships_as_dependent: [{ consent_evidences: [] }] as Array<{
        consent_evidences: Array<{ evidence_id: string }>;
      }>,
      user_id: dependentId,
      name: 'Ana',
      paternal_last_name: 'Pérez',
      maternal_last_name: 'López',
      birthday: new Date(`${birthday(9)}T00:00:00.000Z`),
      user_image: null,
      country_id: null,
      users_pr: { complete: false },
      dependent_profile: { frozen_at: null },
      account: [] as Array<{ id: string }>,
      supervised_login: null as null | {
        method: string;
        login_handle: string | null;
        origin: string;
        enabled_at: Date | null;
        disabled_at: Date | null;
      },
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
    $executeRaw: jest.fn().mockResolvedValue(0),
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
        .mockResolvedValue({ relationship_type_id: REL_TYPE, name: 'Madre' }),
      findMany: jest.fn().mockResolvedValue([]),
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
    expect(tx.$executeRaw).toHaveBeenCalledTimes(1);
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
    it('allows a child turning 13 tomorrow and, since 3a, a child who is already 13 or 14 (a guardian can enable a handle login)', async () => {
      const young = setup();
      await young.service.createDependent(
        GUARDIAN,
        dto({ birthday: birthday(13, 1) }),
      );
      expect(young.tx.users.create).toHaveBeenCalled();

      for (const years of [13, 14, 17]) {
        const { service, tx } = setup();
        await service.createDependent(
          GUARDIAN,
          dto({ birthday: birthday(years) }),
        );
        expect(tx.users.create).toHaveBeenCalledTimes(1);
      }
    });

    it('rejects a child who is exactly 18 today (the age of majority)', async () => {
      const { service, tx } = setup();
      expect(
        await codeOf(
          service.createDependent(GUARDIAN, dto({ birthday: birthday(18) })),
        ),
      ).toBe(ErrorCode.GUARDIANSHIP_DEPENDENT_AGE_OUT_OF_RANGE);
      expect(tx.users.create).not.toHaveBeenCalled();
    });

    it('allows a child who turns 18 tomorrow', async () => {
      const { service, tx } = setup();
      await service.createDependent(
        GUARDIAN,
        dto({ birthday: birthday(18, 1) }),
      );
      expect(tx.users.create).toHaveBeenCalled();
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

    it('uses the country majority: 16 is a minor under 18 but an adult under 16', async () => {
      const { service, policy } = setup();
      await expect(
        service.createDependent(GUARDIAN, dto({ birthday: birthday(16) })),
      ).resolves.toBeDefined();

      policy.getPolicy.mockResolvedValue({
        minSelfLoginAge: 13,
        ageOfMajority: 16,
        timeZone: TZ,
      });
      await expect(
        service.createDependent(GUARDIAN, dto({ birthday: birthday(16) })),
      ).rejects.toBeDefined();
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

    it.each(GUARDIAN_RELATIONSHIP_TYPE_NAMES)(
      'accepts the allowed relationship %s',
      async (name) => {
        const { service, prisma } = setup();
        prisma.relationship_types.findFirst.mockResolvedValue({
          relationship_type_id: REL_TYPE,
          name,
        });
        await expect(
          service.createDependent(GUARDIAN, dto()),
        ).resolves.toBeDefined();
        expect(prisma.relationship_types.findFirst).toHaveBeenCalledWith({
          where: { relationship_type_id: REL_TYPE, active: true },
          select: { relationship_type_id: true, name: true },
        });
      },
    );

    it.each(['Esposa', 'Esposo', 'Cuñado', 'Hijo', 'Suegra'])(
      'rejects the real but disallowed relationship %s with 400 NOT_ALLOWED',
      async (name) => {
        const { service, prisma } = setup();
        prisma.relationship_types.findFirst.mockResolvedValue({
          relationship_type_id: REL_TYPE,
          name,
        });
        const error = await service
          .createDependent(GUARDIAN, dto())
          .catch((e) => e);
        expect(error.code).toBe(
          ErrorCode.GUARDIANSHIP_RELATIONSHIP_TYPE_NOT_ALLOWED,
        );
        expect(error.getStatus()).toBe(400);
        expect(prisma.$transaction).not.toHaveBeenCalled();
      },
    );

    it('matches by exact name: a lookalike is not allowed', async () => {
      const { service, prisma } = setup();
      prisma.relationship_types.findFirst.mockResolvedValue({
        relationship_type_id: REL_TYPE,
        name: 'padre',
      });
      expect(await codeOf(service.createDependent(GUARDIAN, dto()))).toBe(
        ErrorCode.GUARDIANSHIP_RELATIONSHIP_TYPE_NOT_ALLOWED,
      );
    });

    it('rejects an inactive allowed type (the lookup filters active) with INVALID', async () => {
      const { service, prisma } = setup();
      // An inactive "Padre" is filtered out by `active: true`, so no row.
      prisma.relationship_types.findFirst.mockResolvedValue(null);
      expect(await codeOf(service.createDependent(GUARDIAN, dto()))).toBe(
        ErrorCode.GUARDIANSHIP_RELATIONSHIP_TYPE_INVALID,
      );
      expect(prisma.relationship_types.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { relationship_type_id: REL_TYPE, active: true },
        }),
      );
    });
  });
});

describe('GuardianshipsService.listGuardianRelationshipTypes', () => {
  const row = (name: string) => ({
    relationship_type_id: `id-${name}`,
    name,
    description: null,
  });

  it('queries only active rows whose name is in the allowlist', async () => {
    const { service, prisma } = setup();
    await service.listGuardianRelationshipTypes();
    expect(prisma.relationship_types.findMany).toHaveBeenCalledWith({
      where: {
        active: true,
        name: { in: [...GUARDIAN_RELATIONSHIP_TYPE_NAMES] },
      },
      select: { relationship_type_id: true, name: true, description: true },
    });
  });

  it('returns the rows in allowlist order, not DB order', async () => {
    const { service, prisma } = setup();
    prisma.relationship_types.findMany.mockResolvedValue(
      ['Otro', 'Tía', 'Madre', 'Hermano/a Mayor', 'Padre', 'Abuelo'].map(row),
    );
    const result = await service.listGuardianRelationshipTypes();
    expect(result.map((r) => r.name)).toEqual([
      'Padre',
      'Madre',
      'Abuelo',
      'Tía',
      'Hermano/a Mayor',
      'Otro',
    ]);
    expect(Object.keys(result[0]).sort()).toEqual([
      'description',
      'name',
      'relationship_type_id',
    ]);
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
    row.dependent.guardianships_as_dependent = [
      { consent_evidences: [{ evidence_id: 'e-1' }] },
    ];
    row.dependent.dependent_profile = { frozen_at: new Date() } as never;
    prisma.guardianships.findMany.mockResolvedValue([row]);

    const [summary] = (await service.listForGuardian(GUARDIAN)).dependents;
    expect(summary.guardianship.evidence_uploaded).toBe(true);
    expect(summary.frozen).toBe(true);
  });

  describe('access mode, supervised login and milestone in the summary (phase 3a)', () => {
    const summaryOf = async (
      customize: (row: ReturnType<typeof summaryRow>) => void,
      policy?: { minSelfLoginAge: number; ageOfMajority: number },
    ) => {
      const { service, prisma, policy: policyMock } = setup();
      if (policy) {
        policyMock.getPolicy.mockResolvedValue({ ...policy, timeZone: TZ });
      }
      const row = summaryRow('d-1');
      customize(row);
      prisma.guardianships.findMany.mockResolvedValue([row]);
      return (await service.listForGuardian(GUARDIAN)).dependents[0];
    };

    const teenBirthday = (years: number) =>
      new Date(`${birthday(years)}T00:00:00.000Z`);

    it('a plain dependent is guardian_managed with no login, no devices and no milestone below 13', async () => {
      const summary = await summaryOf(() => undefined);
      expect(summary).toMatchObject({
        access_mode: 'guardian_managed',
        supervised_login: null,
        linked_devices_count: 0,
        age_milestone_reached: false,
      });
    });

    it('flags the milestone for a 13-17 child without account or login (and not at 12 or 18)', async () => {
      expect(
        (await summaryOf((r) => (r.dependent.birthday = teenBirthday(13))))
          .age_milestone_reached,
      ).toBe(true);
      expect(
        (await summaryOf((r) => (r.dependent.birthday = teenBirthday(12))))
          .age_milestone_reached,
      ).toBe(false);
      expect(
        (await summaryOf((r) => (r.dependent.birthday = teenBirthday(18))))
          .age_milestone_reached,
      ).toBe(false);
    });

    it('follows the country policy for the milestone (min 16)', async () => {
      const summary = await summaryOf(
        (r) => (r.dependent.birthday = teenBirthday(14)),
        { minSelfLoginAge: 16, ageOfMajority: 18 },
      );
      expect(summary.age_milestone_reached).toBe(false);
    });

    it('an enabled login is supervised_login: the handle shows to a VERIFIED guardian only', async () => {
      const login = {
        method: 'handle',
        login_handle: 'ana-7kq4m9tx',
        origin: 'guardian_enabled',
        enabled_at: new Date('2026-10-01T00:00:00Z'),
        disabled_at: null,
      };
      const verified = await summaryOf((r) => {
        r.dependent.account = [{ id: 'acc' }];
        r.dependent.supervised_login = login;
        r.consent_status = 'verified';
      });
      expect(verified).toMatchObject({
        access_mode: 'supervised_login',
        age_milestone_reached: false,
        supervised_login: {
          method: 'handle',
          login_handle: 'ana-7kq4m9tx',
          enabled_at: '2026-10-01T00:00:00.000Z',
          disabled_at: null,
        },
      });

      const pending = await summaryOf((r) => {
        r.dependent.account = [{ id: 'acc' }];
        r.dependent.supervised_login = login;
        r.consent_status = 'pending';
      });
      expect(pending.supervised_login?.login_handle).toBeNull();
      expect(pending.supervised_login?.method).toBe('handle');
    });

    it('a guardian-enabled login that was disabled hands the child back (guardian_managed)', async () => {
      const summary = await summaryOf((r) => {
        r.dependent.account = [{ id: 'acc' }];
        r.dependent.supervised_login = {
          method: 'handle',
          login_handle: 'ana-7kq4m9tx',
          origin: 'guardian_enabled',
          enabled_at: new Date('2026-10-01T00:00:00Z'),
          disabled_at: new Date('2026-10-05T00:00:00Z'),
        };
        r.consent_status = 'verified';
      });
      expect(summary.access_mode).toBe('guardian_managed');
      expect(summary.supervised_login?.disabled_at).toBe(
        '2026-10-05T00:00:00.000Z',
      );
    });

    it('a self-registered teen stays supervised_login even when its login is disabled (never actable)', async () => {
      const summary = await summaryOf((r) => {
        r.dependent.account = [{ id: 'acc' }];
        r.dependent.supervised_login = {
          method: 'email',
          login_handle: null,
          origin: 'self_registered',
          enabled_at: null,
          disabled_at: new Date('2026-10-05T00:00:00Z'),
        };
      });
      expect(summary.access_mode).toBe('supervised_login');
    });
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
