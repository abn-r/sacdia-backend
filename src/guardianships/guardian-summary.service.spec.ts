import { ACTING_SCOPE_KEY } from '../auth/acting-for/acting-scope.decorator';
import { ErrorCode } from '../common/errors/error-codes';
import { GuardianSummaryController } from './guardian-summary.controller';
import { GuardianPowersPolicy } from './guardian-powers.policy';
import { GuardianSummaryService } from './guardian-summary.service';

const GUARDIAN = 'aaaaaaaa-0000-4000-8000-000000000001';
const OTHER = 'aaaaaaaa-0000-4000-8000-000000000002';
const DEP = 'dddddddd-0000-4000-8000-000000000001';
const NOW = new Date('2026-10-20T15:00:00.000Z');

const yearsAgo = (years: number): Date => {
  const d = new Date(NOW);
  d.setUTCFullYear(d.getUTCFullYear() - years);
  d.setUTCDate(d.getUTCDate() - 3);
  return d;
};

function setup(
  options: {
    consent?: 'verified' | 'pending';
    birthday?: Date | null;
    account?: boolean;
    login?: { origin: string; disabled_at: Date | null } | null;
  } = {},
) {
  const prisma: any = {
    guardianships: {
      findFirst: jest.fn(async ({ where }: any) =>
        where.guardian_user_id === GUARDIAN
          ? {
              guardianship_id: 'gs-1',
              dependent_user_id: DEP,
              guardian_user_id: GUARDIAN,
              consent_status: options.consent ?? 'verified',
            }
          : null,
      ),
    },
    users: {
      findUnique: jest.fn().mockResolvedValue({
        user_id: DEP,
        name: 'Ana',
        birthday:
          options.birthday === undefined ? yearsAgo(15) : options.birthday,
        country_id: null,
        account: options.account ? [{ id: 'acc' }] : [],
        supervised_login: options.login ?? null,
      }),
    },
    enrollments: {
      findMany: jest.fn().mockResolvedValue([
        {
          enrollment_id: 11,
          class_id: 3,
          investiture_status: 'IN_PROGRESS',
          classes: { name: 'Amigo' },
        },
        {
          enrollment_id: 12,
          class_id: 4,
          investiture_status: 'SUBMITTED_FOR_VALIDATION',
          classes: { name: 'Compañero' },
        },
        // An older enrollment of class 3 must not be repeated.
        {
          enrollment_id: 5,
          class_id: 3,
          investiture_status: 'APPROVED',
          classes: { name: 'Amigo' },
        },
      ]),
    },
    users_honors: {
      count: jest
        .fn()
        .mockImplementation(async ({ where }: any) =>
          where.validation_status === 'APPROVED' ? 3 : 2,
        ),
    },
    club_role_assignments: {
      findFirst: jest.fn().mockResolvedValue({ club_section_id: 9 }),
    },
    activities: {
      findMany: jest.fn().mockResolvedValue([
        {
          activity_date: new Date('2026-03-01'),
          attendees: [DEP, 'other-kid'],
        },
        { activity_date: new Date('2026-05-10'), attendees: ['other-kid'] },
        { activity_date: new Date('2026-08-15'), attendees: [DEP] },
        { activity_date: new Date('2026-09-01'), attendees: null },
      ]),
    },
  };
  const powers = new GuardianPowersPolicy(prisma);
  const eligibility = {
    calculateForEnrollment: jest.fn(async (id: number) =>
      id === 11
        ? {
            overall_progress: 62,
            investiture_progress: { completed: 5, total: 8, percentage: 62 },
            // Sensitive-ish internals the summary must never copy:
            required_investiture_section_ids: [1, 2, 3],
            completed_required_section_ids: [1],
          }
        : null,
    ),
  };
  const ecclesiasticalYear = {
    getCurrentYear: jest.fn().mockResolvedValue({
      year_id: 7,
      start_date: new Date('2026-01-01'),
      end_date: new Date('2026-12-31'),
    }),
  };
  const agePolicy = {
    getPolicy: jest.fn().mockResolvedValue({
      minSelfLoginAge: 13,
      ageOfMajority: 18,
      timeZone: 'America/Mexico_City',
    }),
  };
  const audit = { recordEvent: jest.fn().mockResolvedValue(undefined) };
  const service = new GuardianSummaryService(
    prisma,
    powers,
    eligibility as any,
    ecclesiasticalYear as any,
    agePolicy as any,
    audit as any,
  );
  return { service, prisma, eligibility, ecclesiasticalYear, agePolicy, audit };
}

beforeAll(() => {
  jest.useFakeTimers({ doNotFake: ['setImmediate', 'nextTick'] });
  jest.setSystemTime(NOW);
});
afterAll(() => jest.useRealTimers());

/** Every key path of a JSON value, e.g. "classes[].name". */
function keyPaths(value: unknown, prefix = ''): string[] {
  if (Array.isArray(value)) {
    return [...new Set(value.flatMap((item) => keyPaths(item, `${prefix}[]`)))];
  }
  if (value && typeof value === 'object') {
    return Object.entries(value).flatMap(([key, child]) => {
      const path = prefix ? `${prefix}.${key}` : key;
      return [path, ...keyPaths(child, path)];
    });
  }
  return [];
}

describe('GuardianSummaryService', () => {
  it('returns exactly the allowlisted keys (deep scan, nested included)', async () => {
    const { service } = setup();
    const summary = await service.getSummary(GUARDIAN, DEP);

    expect(keyPaths(summary).sort()).toEqual(
      [
        'attendance',
        'attendance.activities_attended',
        'attendance.activities_total',
        'attendance.from',
        'attendance.last_attended_on',
        'attendance.to',
        'classes',
        'classes[].class_id',
        'classes[].name',
        'classes[].progress_percent',
        'classes[].sections_completed',
        'classes[].sections_total',
        'classes[].status',
        'dependent',
        'dependent.access_mode',
        'dependent.age',
        'dependent.name',
        'dependent.user_id',
        'dues',
        'generated_at',
        'honors',
        'honors.completed',
        'honors.in_progress',
      ].sort(),
    );
  });

  it('never contains health, evidence, notes, contact, location or message keys', async () => {
    const { service } = setup();
    const serialized = JSON.stringify(await service.getSummary(GUARDIAN, DEP));
    for (const forbidden of [
      'allerg',
      'disease',
      'medicine',
      'emergency',
      'blood',
      'evidence',
      'note',
      'counselor',
      'phone',
      'email',
      'address',
      'lat',
      'long',
      'message',
      'password',
      'handle',
    ]) {
      expect(serialized.toLowerCase()).not.toContain(forbidden);
    }
  });

  it('does not even read health tables', async () => {
    const { prisma, service } = setup();
    await service.getSummary(GUARDIAN, DEP);
    for (const table of [
      'users_allergies',
      'users_diseases',
      'users_medicines',
      'emergency_contacts',
      'evidence_files',
    ]) {
      expect(prisma).not.toHaveProperty(table);
    }
  });

  it('reports class progress per class (newest enrollment only) and honor counts', async () => {
    const { service, prisma } = setup();
    const summary = await service.getSummary(GUARDIAN, DEP);

    expect(prisma.enrollments.findMany.mock.calls[0][0].where).toEqual({
      user_id: DEP,
      active: true,
      record_kind: 'OPERATIONAL',
    });
    expect(summary.classes).toEqual([
      {
        class_id: 3,
        name: 'Amigo',
        status: 'IN_PROGRESS',
        progress_percent: 62,
        sections_completed: 5,
        sections_total: 8,
      },
      {
        class_id: 4,
        name: 'Compañero',
        status: 'SUBMITTED_FOR_VALIDATION',
        progress_percent: 0,
        sections_completed: 0,
        sections_total: 0,
      },
    ]);
    expect(summary.honors).toEqual({ completed: 3, in_progress: 2 });
  });

  it('computes attendance for the current ecclesiastical year up to today, with no other attendee data', async () => {
    const { service, prisma } = setup();
    const summary = await service.getSummary(GUARDIAN, DEP);

    expect(summary.attendance).toEqual({
      from: '2026-01-01',
      to: '2026-10-20',
      activities_total: 4,
      activities_attended: 2,
      last_attended_on: '2026-08-15',
    });
    const where = prisma.activities.findMany.mock.calls[0][0].where;
    expect(where).toMatchObject({ club_section_id: 9, active: true });
    expect(where.activity_date.lte.toISOString().slice(0, 10)).toBe(
      '2026-10-20',
    );
    expect(JSON.stringify(summary)).not.toContain('other-kid');
  });

  it('attendance is zeros without an active section or without a current year', async () => {
    const noSection = setup();
    noSection.prisma.club_role_assignments.findFirst.mockResolvedValue(null);
    expect(
      (await noSection.service.getSummary(GUARDIAN, DEP)).attendance,
    ).toEqual({
      from: '2026-01-01',
      to: '2026-10-20',
      activities_total: 0,
      activities_attended: 0,
      last_attended_on: null,
    });

    const noYear = setup();
    noYear.ecclesiasticalYear.getCurrentYear.mockRejectedValue(
      new Error('none'),
    );
    expect((await noYear.service.getSummary(GUARDIAN, DEP)).attendance).toEqual(
      {
        from: null,
        to: null,
        activities_total: 0,
        activities_attended: 0,
        last_attended_on: null,
      },
    );
  });

  it('dues is null (no ledger in phase 3)', async () => {
    const { service } = setup();
    expect((await service.getSummary(GUARDIAN, DEP)).dues).toBeNull();
  });

  describe('who may', () => {
    it('a stranger or the guardian of another child is 404 GUARDIANSHIP_NOT_FOUND', async () => {
      const { service } = setup();
      await expect(service.getSummary(OTHER, DEP)).rejects.toMatchObject({
        code: ErrorCode.GUARDIANSHIP_NOT_FOUND,
        status: 404,
      });
    });

    it('a PENDING guardian is 409 GUARDIANSHIP_CONSENT_NOT_VERIFIED and nothing is read', async () => {
      const { service, prisma } = setup({ consent: 'pending' });
      await expect(service.getSummary(GUARDIAN, DEP)).rejects.toMatchObject({
        code: ErrorCode.GUARDIANSHIP_CONSENT_NOT_VERIFIED,
        status: 409,
      });
      expect(prisma.users.findUnique).not.toHaveBeenCalled();
      expect(prisma.enrollments.findMany).not.toHaveBeenCalled();
    });

    it('a person who reached the age of majority is 404 (the former guardian sees nothing)', async () => {
      const { service, audit } = setup({ birthday: yearsAgo(19) });
      await expect(service.getSummary(GUARDIAN, DEP)).rejects.toMatchObject({
        code: ErrorCode.GUARDIANSHIP_NOT_FOUND,
        status: 404,
      });
      expect(audit.recordEvent).not.toHaveBeenCalled();
    });

    it('turns 18 today: 404; turns 18 tomorrow: still readable', async () => {
      expect(
        await setup({ birthday: new Date('2008-10-21T00:00:00Z') })
          .service.getSummary(GUARDIAN, DEP)
          .then((s) => s.dependent.age),
      ).toBe(17);
      await expect(
        setup({
          birthday: new Date('2008-10-20T00:00:00Z'),
        }).service.getSummary(GUARDIAN, DEP),
      ).rejects.toMatchObject({ status: 404 });
    });

    it('a child without a birthday is 404', async () => {
      await expect(
        setup({ birthday: null }).service.getSummary(GUARDIAN, DEP),
      ).rejects.toMatchObject({ status: 404 });
    });

    it('follows the country majority (16)', async () => {
      const { service, agePolicy } = setup({ birthday: yearsAgo(16) });
      agePolicy.getPolicy.mockResolvedValue({
        minSelfLoginAge: 13,
        ageOfMajority: 16,
        timeZone: 'America/Mexico_City',
      });
      await expect(service.getSummary(GUARDIAN, DEP)).rejects.toMatchObject({
        status: 404,
      });
    });
  });

  describe('access mode (works for every mode)', () => {
    it('a plain child is guardian_managed', async () => {
      expect(
        (await setup().service.getSummary(GUARDIAN, DEP)).dependent.access_mode,
      ).toBe('guardian_managed');
    });
    it('an enabled own login is supervised_login', async () => {
      const summary = await setup({
        account: true,
        login: { origin: 'guardian_enabled', disabled_at: null },
      }).service.getSummary(GUARDIAN, DEP);
      expect(summary.dependent.access_mode).toBe('supervised_login');
    });
    it('a guardian-enabled login that was disabled is guardian_managed again', async () => {
      const summary = await setup({
        account: true,
        login: { origin: 'guardian_enabled', disabled_at: NOW },
      }).service.getSummary(GUARDIAN, DEP);
      expect(summary.dependent.access_mode).toBe('guardian_managed');
    });
  });

  it('audits every read as guardianship.summary_viewed with the real actor and the child as target', async () => {
    const { service, audit } = setup();
    await service.getSummary(GUARDIAN, DEP);
    expect(audit.recordEvent).toHaveBeenCalledWith({
      entity_type: 'guardianship',
      entity_id: 'gs-1',
      action: 'summary_viewed',
      actor_user_id: GUARDIAN,
      target_user_id: DEP,
      summary: expect.any(String),
    });
  });

  it('an audit failure never blocks the read', async () => {
    const { service, audit } = setup();
    audit.recordEvent.mockRejectedValue(new Error('audit down'));
    await expect(service.getSummary(GUARDIAN, DEP)).resolves.toBeDefined();
  });
});

describe('GuardianSummaryController', () => {
  it('declares NO acting scope (acting and teens are refused) and a 60/h throttle', () => {
    const handler = GuardianSummaryController.prototype.getSummary;
    expect(Reflect.getMetadata(ACTING_SCOPE_KEY, handler)).toBeUndefined();
    expect(
      Reflect.getMetadata(ACTING_SCOPE_KEY, GuardianSummaryController),
    ).toBeUndefined();
    for (const tier of ['short', 'medium', 'long']) {
      expect(Reflect.getMetadata(`THROTTLER:LIMIT${tier}`, handler)).toBe(60);
      expect(Reflect.getMetadata(`THROTTLER:TTL${tier}`, handler)).toBe(
        3_600_000,
      );
    }
  });

  it('wraps the summary in the success envelope for the token subject', async () => {
    const summary = { getSummary: jest.fn().mockResolvedValue({ dues: null }) };
    const controller = new GuardianSummaryController(summary as any);
    expect(await controller.getSummary({ sub: GUARDIAN }, DEP)).toEqual({
      status: 'success',
      data: { dues: null },
    });
    expect(summary.getSummary).toHaveBeenCalledWith(GUARDIAN, DEP);
  });
});
