import { Logger } from '@nestjs/common';
import { AppException } from '../common/errors/app.exception';
import { ErrorCode } from '../common/errors/error-codes';
import { DirectorDependentsService } from './director-dependents.service';

const DIRECTOR = 'dddddddd-0000-4000-8000-000000000001';
const SECRETARY = 'dddddddd-0000-4000-8000-000000000002';
const DEPUTY = 'dddddddd-0000-4000-8000-000000000003';
const SECTION = 12;
const MAIN_CLUB = 5;
const COUNTRY_MX = 1;
const COUNTRY_MAJORITY_16 = 2;
const YEAR = { year_id: 77, start_date: new Date('2026-01-01T00:00:00.000Z') };
const TERMS = '2.0.0-family';

/** A YYYY-MM-DD that makes someone `years` old today plus a week of margin. */
function bornYearsAgo(years: number): string {
  const date = new Date();
  date.setUTCFullYear(date.getUTCFullYear() - years);
  date.setUTCDate(date.getUTCDate() - 7);
  return date.toISOString().slice(0, 10);
}

function dto(overrides: Record<string, unknown> = {}) {
  return {
    name: 'Luis',
    paternal_last_name: 'Pérez',
    maternal_last_name: 'López',
    birthday: bornYearsAgo(15),
    gender: 'M',
    sworn_declaration: true,
    accepted_terms_version: TERMS,
    accepted_privacy_version: TERMS,
    ...overrides,
  } as never;
}

async function rejection(promise: Promise<unknown>): Promise<AppException> {
  try {
    await promise;
  } catch (error) {
    return error as AppException;
  }
  throw new Error('expected a rejection');
}

type Write = { table: string; op: string; data: Record<string, any> };

/**
 * A transaction double with REAL commit/rollback semantics: writes are staged
 * and only reach `committed` when the callback returns. A throw discards them,
 * which is what proves "no users row persists" when a later step fails.
 */
function setup(
  options: {
    countryId?: number;
    mainClubId?: number | null;
    section?: 'missing';
    year?: typeof YEAR | null;
    failOn?: string;
    reviewers?: string[];
  } = {},
) {
  const committed: Write[] = [];
  const order: string[] = [];
  let staged: Write[] = [];

  const record = (table: string, op: string, data: Record<string, any>) => {
    order.push(`${table}.${op}`);
    if (options.failOn === `${table}.${op}`) {
      throw new Error(`boom ${table}.${op}`);
    }
    staged.push({ table, op, data });
  };

  const tx: any = {
    ecclesiastical_years: {
      findFirst: jest.fn().mockImplementation(() => {
        order.push('year.read');
        return Promise.resolve(
          options.year === undefined ? YEAR : options.year,
        );
      }),
    },
    roles: {
      findFirst: jest
        .fn()
        .mockImplementation(({ where }: any) =>
          Promise.resolve(
            where.role_name === 'member'
              ? { role_id: 'role-member' }
              : { role_id: 'role-user' },
          ),
        ),
    },
    users: {
      create: jest.fn().mockImplementation(({ data }: any) => {
        record('users', 'create', data);
        return Promise.resolve(data);
      }),
    },
    users_pr: {
      create: jest.fn().mockImplementation(({ data }: any) => {
        record('users_pr', 'create', data);
        return Promise.resolve(data);
      }),
    },
    users_roles: {
      create: jest.fn().mockImplementation(({ data }: any) => {
        record('users_roles', 'create', data);
        return Promise.resolve(data);
      }),
    },
    dependent_profiles: {
      create: jest.fn().mockImplementation(({ data }: any) => {
        record('dependent_profiles', 'create', data);
        return Promise.resolve(data);
      }),
    },
    guardianships: {
      create: jest.fn().mockImplementation(({ data }: any) => {
        record('guardianships', 'create', data);
        return Promise.resolve({ guardianship_id: 'g-custody', ...data });
      }),
    },
    club_role_assignments: {
      create: jest.fn().mockImplementation(({ data }: any) => {
        record('club_role_assignments', 'create', data);
        return Promise.resolve({ assignment_id: 'a-pending', ...data });
      }),
    },
    audit_logs: {
      create: jest.fn().mockImplementation(({ data }: any) => {
        record('audit_logs', 'create', data);
        return Promise.resolve(data);
      }),
    },
  };

  const prisma: any = {
    club_sections: {
      findUnique: jest.fn().mockImplementation(() => {
        order.push('section.read');
        if (options.section === 'missing') return Promise.resolve(null);
        return Promise.resolve({
          club_section_id: SECTION,
          main_club_id:
            options.mainClubId === undefined ? MAIN_CLUB : options.mainClubId,
          clubs: {
            local_fields: {
              unions: { country_id: options.countryId ?? COUNTRY_MX },
            },
          },
        });
      }),
    },
    club_role_assignments: {
      findMany: jest
        .fn()
        .mockImplementation(() =>
          Promise.resolve(
            (options.reviewers ?? [DIRECTOR, SECRETARY, DEPUTY, SECRETARY]).map(
              (user_id) => ({ user_id }),
            ),
          ),
        ),
    },
    $transaction: jest.fn(async (callback: (client: unknown) => unknown) => {
      staged = [];
      try {
        const result = await callback(tx);
        committed.push(...staged);
        order.push('commit');
        return result;
      } catch (error) {
        staged = [];
        order.push('rollback');
        throw error;
      }
    }),
  };

  const countryAgePolicy: any = {
    getPolicy: jest.fn().mockImplementation((countryId: number) =>
      Promise.resolve({
        minSelfLoginAge: 13,
        ageOfMajority: countryId === COUNTRY_MAJORITY_16 ? 16 : 18,
        timeZone: 'America/Mexico_City',
      }),
    ),
  };
  const legal: any = {
    assertCurrentVersions: jest
      .fn()
      .mockImplementation((versions: { terms: string; privacy: string }) => {
        order.push('legal.assert');
        if (versions.terms !== TERMS || versions.privacy !== TERMS) {
          throw new AppException(ErrorCode.LEGAL_VERSION_MISMATCH, 400);
        }
      }),
    recordOnBehalf: jest
      .fn()
      .mockImplementation(
        (_tx: unknown, dependentId: string, _v: unknown, actor: string) => {
          record('legal_acceptances', 'on_behalf', { dependentId, actor });
          return Promise.resolve();
        },
      ),
  };
  const actingCache: any = {
    bump: jest.fn().mockImplementation(() => {
      order.push('bump');
      return Promise.resolve();
    }),
  };
  const notifications: any = {
    sendToUser: jest.fn().mockImplementation(() => {
      order.push('notify');
      return Promise.resolve({ success: true });
    }),
  };

  const service = new DirectorDependentsService(
    prisma,
    countryAgePolicy,
    legal,
    actingCache,
    notifications,
  );
  return {
    service,
    prisma,
    tx,
    legal,
    actingCache,
    notifications,
    countryAgePolicy,
    committed,
    order,
    wrote: (table: string, op = 'create') =>
      committed.filter((w) => w.table === table && w.op === op),
  };
}

const flush = () => new Promise((resolve) => setImmediate(resolve));

describe('DirectorDependentsService.create (FP3-61)', () => {
  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  });
  afterEach(() => jest.restoreAllMocks());

  describe('a 15-year-old, all rows in ONE transaction', () => {
    it('creates user, profile, custody, pending assignment, legal acceptance and audit; consent stays pending and there is no account', async () => {
      const s = setup();
      const input = dto();

      const result = await s.service.create(DIRECTOR, SECTION, input, {
        ipAddress: '10.0.0.1',
      });

      expect(s.prisma.$transaction).toHaveBeenCalledTimes(1);

      const [user] = s.wrote('users');
      expect(user.data).toMatchObject({
        user_id: expect.stringMatching(/^[0-9a-f-]{36}$/),
        email: null,
        name: 'Luis',
        paternal_last_name: 'Pérez',
        maternal_last_name: 'López',
        gender: 'M',
        // The country of the SECTION's club, not the director's.
        country_id: COUNTRY_MX,
      });
      expect(user.data.birthday).toEqual(
        new Date(`${(input as any).birthday}T00:00:00.000Z`),
      );
      const dependentId = user.data.user_id;

      expect(s.wrote('users_pr')[0].data).toEqual({
        user_id: dependentId,
        complete: false,
        profile_picture_complete: false,
        personal_info_complete: false,
        club_selection_complete: false,
      });
      expect(s.wrote('users_roles')[0].data).toEqual({
        user_id: dependentId,
        role_id: 'role-user',
      });
      expect(s.wrote('dependent_profiles')[0].data).toEqual({
        user_id: dependentId,
        created_by_user_id: DIRECTOR,
      });
      expect(s.wrote('guardianships')[0].data).toEqual({
        dependent_user_id: dependentId,
        guardian_user_id: null,
        is_custodian: true,
        custodian_club_id: MAIN_CLUB,
        is_primary: true,
        consent_status: 'pending',
        sworn_declaration_at: expect.any(Date),
      });
      expect(s.wrote('club_role_assignments')[0].data).toEqual({
        user_id: dependentId,
        role_id: 'role-member',
        club_section_id: SECTION,
        ecclesiastical_year_id: YEAR.year_id,
        start_date: YEAR.start_date,
        active: true,
        status: 'pending',
        expires_at: expect.any(Date),
      });
      // R10: terms + privacy accepted FOR the minor, recorded by the director.
      expect(s.legal.recordOnBehalf).toHaveBeenCalledWith(
        s.tx,
        dependentId,
        { terms: TERMS, privacy: TERMS },
        DIRECTOR,
        { ipAddress: '10.0.0.1' },
      );
      expect(s.wrote('audit_logs')[0].data).toMatchObject({
        entity_type: 'dependent',
        entity_id: dependentId,
        action: 'created_by_director',
        actor_user_id: DIRECTOR,
        actor_kind: 'user',
        target_user_id: dependentId,
        result: 'succeeded',
        changes: expect.objectContaining({
          club_section_id: SECTION,
          assignment_id: 'a-pending',
          guardianship_id: 'g-custody',
          custodian_club_id: MAIN_CLUB,
          ecclesiastical_year_id: YEAR.year_id,
        }),
      });

      expect(result).toEqual({
        dependent: {
          user_id: dependentId,
          name: 'Luis',
          birthday: (input as any).birthday,
          age: 15,
        },
        guardianship: {
          guardianship_id: 'g-custody',
          is_custodian: true,
          consent_status: 'pending',
        },
        assignment: {
          assignment_id: 'a-pending',
          status: 'pending',
          club_section_id: SECTION,
        },
      });
    });

    it('never writes an account, a credential, a supervised login or a verified state', async () => {
      const s = setup();
      await s.service.create(DIRECTOR, SECTION, dto());

      const tables = s.committed.map((w) => w.table);
      for (const forbidden of ['account', 'supervised_logins', 'sessions']) {
        expect(tables).not.toContain(forbidden);
      }
      const custody = s.wrote('guardianships')[0].data;
      expect(custody.verified_at).toBeUndefined();
      expect(custody.verified_by_user_id).toBeUndefined();
      expect(custody.consent_status).toBe('pending');
    });

    it('stores a literal pending status and never an active one', async () => {
      const s = setup();
      await s.service.create(DIRECTOR, SECTION, dto());

      expect(s.wrote('club_role_assignments')[0].data.status).toBe('pending');
    });

    it('runs the stale-version check first, then reads, then writes, then bumps and notifies only after the commit', async () => {
      const s = setup();
      await s.service.create(DIRECTOR, SECTION, dto());
      await flush();

      expect(s.order).toEqual([
        'legal.assert',
        'section.read',
        'year.read',
        'users.create',
        'users_pr.create',
        'users_roles.create',
        'dependent_profiles.create',
        'guardianships.create',
        'club_role_assignments.create',
        'legal_acceptances.on_behalf',
        'audit_logs.create',
        'commit',
        'bump',
        'notify',
        'notify',
      ]);
      expect(s.actingCache.bump).toHaveBeenCalledTimes(1);
    });
  });

  describe('age (policy of the SECTION country)', () => {
    it('a 4-year-old is accepted (0 <= age)', async () => {
      const s = setup();

      const result = await s.service.create(
        DIRECTOR,
        SECTION,
        dto({ birthday: bornYearsAgo(4) }),
      );

      expect(result.dependent.age).toBe(4);
    });

    it('a baby born this week is accepted (age 0)', async () => {
      const s = setup();
      const born = new Date();
      born.setUTCDate(born.getUTCDate() - 3);

      const result = await s.service.create(
        DIRECTOR,
        SECTION,
        dto({ birthday: born.toISOString().slice(0, 10) }),
      );

      expect(result.dependent.age).toBe(0);
    });

    it.each([
      ['an 18-year-old', bornYearsAgo(18)],
      ['someone older', bornYearsAgo(40)],
      ['a future date', '2999-01-01'],
      ['an impossible date', '2016-02-31'],
    ])(
      'rejects %s with 422 GUARDIANSHIP_DEPENDENT_AGE_OUT_OF_RANGE and creates nothing',
      async (_label, birthday) => {
        const s = setup();

        const error = await rejection(
          s.service.create(DIRECTOR, SECTION, dto({ birthday })),
        );

        expect(error.code).toBe(
          ErrorCode.GUARDIANSHIP_DEPENDENT_AGE_OUT_OF_RANGE,
        );
        expect(error.getStatus()).toBe(422);
        expect(s.prisma.$transaction).not.toHaveBeenCalled();
        expect(s.committed).toEqual([]);
        expect(s.actingCache.bump).not.toHaveBeenCalled();
      },
    );

    it('a country with majority 16 rejects a 16-year-old and accepts a 15-year-old', async () => {
      const rejected = setup({ countryId: COUNTRY_MAJORITY_16 });
      const accepted = setup({ countryId: COUNTRY_MAJORITY_16 });

      const error = await rejection(
        rejected.service.create(
          DIRECTOR,
          SECTION,
          dto({ birthday: bornYearsAgo(16) }),
        ),
      );
      const ok = await accepted.service.create(
        DIRECTOR,
        SECTION,
        dto({ birthday: bornYearsAgo(15) }),
      );

      expect(error.code).toBe(
        ErrorCode.GUARDIANSHIP_DEPENDENT_AGE_OUT_OF_RANGE,
      );
      expect(ok.dependent.age).toBe(15);
      expect(rejected.countryAgePolicy.getPolicy).toHaveBeenCalledWith(
        COUNTRY_MAJORITY_16,
      );
      // The same 16-year-old is a minor in the default country.
      const mexico = setup();
      expect(
        (
          await mexico.service.create(
            DIRECTOR,
            SECTION,
            dto({ birthday: bornYearsAgo(16) }),
          )
        ).dependent.age,
      ).toBe(16);
    });
  });

  describe('legal versions', () => {
    it.each([
      ['terms', { accepted_terms_version: '1.0.0-store' }],
      ['privacy', { accepted_privacy_version: '1.0.0-store' }],
    ])(
      'a stale %s version is 400 LEGAL_VERSION_MISMATCH before anything is read',
      async (_label, overrides) => {
        const s = setup();

        const error = await rejection(
          s.service.create(DIRECTOR, SECTION, dto(overrides)),
        );

        expect(error.code).toBe(ErrorCode.LEGAL_VERSION_MISMATCH);
        expect(error.getStatus()).toBe(400);
        expect(s.prisma.club_sections.findUnique).not.toHaveBeenCalled();
        expect(s.prisma.$transaction).not.toHaveBeenCalled();
      },
    );
  });

  describe('failures create nothing', () => {
    it('no active ecclesiastical year: POST_REG_NO_ACTIVE_YEAR and no row of any table is written', async () => {
      const s = setup({ year: null });

      const error = await rejection(s.service.create(DIRECTOR, SECTION, dto()));

      expect(error.code).toBe(ErrorCode.POST_REG_NO_ACTIVE_YEAR);
      expect(s.committed).toEqual([]);
      expect(s.tx.users.create).not.toHaveBeenCalled();
      expect(s.actingCache.bump).not.toHaveBeenCalled();
      expect(s.notifications.sendToUser).not.toHaveBeenCalled();
    });

    it('a failure while creating the assignment rolls EVERYTHING back: no users row persists', async () => {
      const s = setup({ failOn: 'club_role_assignments.create' });

      await expect(s.service.create(DIRECTOR, SECTION, dto())).rejects.toThrow(
        'boom club_role_assignments.create',
      );

      // The user, profile and custody were staged before the failure...
      expect(s.tx.users.create).toHaveBeenCalledTimes(1);
      expect(s.tx.guardianships.create).toHaveBeenCalledTimes(1);
      // ...and none of them was committed.
      expect(s.committed).toEqual([]);
      expect(s.order).toContain('rollback');
      expect(s.actingCache.bump).not.toHaveBeenCalled();
      expect(s.notifications.sendToUser).not.toHaveBeenCalled();
    });

    it('a failure recording the legal acceptance or the audit also rolls everything back', async () => {
      for (const failOn of [
        'legal_acceptances.on_behalf',
        'audit_logs.create',
      ]) {
        const s = setup({ failOn });
        await expect(
          s.service.create(DIRECTOR, SECTION, dto()),
        ).rejects.toThrow();
        expect(s.committed).toEqual([]);
      }
    });

    it('an unknown section is 404 CLUB_SECTION_NOT_FOUND and so is a section without a main club', async () => {
      for (const options of [
        { section: 'missing' as const },
        { mainClubId: null },
      ]) {
        const s = setup(options);
        const error = await rejection(
          s.service.create(DIRECTOR, SECTION, dto()),
        );
        expect(error.code).toBe(ErrorCode.CLUB_SECTION_NOT_FOUND);
        expect(error.getStatus()).toBe(404);
        expect(s.prisma.$transaction).not.toHaveBeenCalled();
      }
    });
  });

  describe('reviewer notice', () => {
    it('tells every reviewer of the section except the creator, once each: "Minor - consent pending"', async () => {
      const s = setup();

      await s.service.create(DIRECTOR, SECTION, dto());
      await flush();

      const recipients = s.notifications.sendToUser.mock.calls.map(
        ([payload]: any) => payload.userId,
      );
      expect(recipients.sort()).toEqual([DEPUTY, SECRETARY].sort());
      expect(recipients).not.toContain(DIRECTOR);
      const [payload, , source] = s.notifications.sendToUser.mock.calls[0];
      expect(payload.title).toBe('Menor · consentimiento pendiente');
      expect(payload.data).toMatchObject({
        type: 'membership_request_created',
        assignmentId: 'a-pending',
        clubSectionId: String(SECTION),
      });
      expect(source).toBe('membership_requests:new_request');
      expect(s.prisma.club_role_assignments.findMany).toHaveBeenCalledWith({
        where: {
          club_section_id: SECTION,
          active: true,
          status: 'active',
          roles: {
            role_name: {
              in: [
                'director',
                'deputy-director',
                'secretary',
                'secretary-treasurer',
              ],
            },
          },
        },
        select: { user_id: true },
      });
    });

    it('a notification failure never fails the creation', async () => {
      const s = setup();
      s.notifications.sendToUser.mockRejectedValue(new Error('fcm down'));

      const result = await s.service.create(DIRECTOR, SECTION, dto());
      await flush();

      expect(result.assignment.status).toBe('pending');
      expect(s.wrote('users')).toHaveLength(1);
    });

    it('no reviewer besides the creator: nobody is notified', async () => {
      const s = setup({ reviewers: [DIRECTOR] });

      await s.service.create(DIRECTOR, SECTION, dto());
      await flush();

      expect(s.notifications.sendToUser).not.toHaveBeenCalled();
    });
  });
});
