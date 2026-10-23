import { AUTHORIZATION_RESOURCE_KEY } from '../common/decorators/authorization-resource.decorator';
import { PERMISSIONS_KEY } from '../common/decorators/permissions.decorator';
import { ErrorCode } from '../common/errors/error-codes';
import { ReportsComplianceController } from './reports-compliance.controller';
import {
  classifyPeriod,
  monthlyPeriods,
  quarterlyPeriods,
  ReportsComplianceService,
} from './reports-compliance.service';

const YEAR = {
  year_id: 1,
  start_date: new Date('2026-01-01T00:00:00.000Z'),
  end_date: new Date('2026-12-31T00:00:00.000Z'),
};

const coordinatorProfile = () =>
  ({
    authorization: {
      grants: {
        global_roles: [
          {
            role_name: 'coordinator',
            permissions: ['reports:read', 'reports:download'],
          },
        ],
        club_assignments: [],
      },
      active_assignment: { assignment_id: null },
      effective: { scope: { global: {} } },
    },
  }) as any;

const adminProfile = () =>
  ({
    authorization: {
      grants: {
        global_roles: [{ role_name: 'admin', permissions: ['reports:read'] }],
        club_assignments: [],
      },
      active_assignment: { assignment_id: null },
      effective: { scope: { global: {} } },
    },
  }) as any;

const section = (
  clubSectionId: number,
  clubId: number,
  clubName: string,
  clubTypeId = 2,
) => ({
  club_section_id: clubSectionId,
  club_type_id: clubTypeId,
  club_types: { name: clubTypeId === 2 ? 'Conquistadores' : 'Aventureros' },
  clubs: {
    club_id: clubId,
    name: clubName,
    local_field_id: 50,
    local_fields: { name: 'Campo Norte' },
  },
});

function setup({
  profile = coordinatorProfile(),
  coordinatorSections = [22, 23],
  sections = [section(22, 10, 'Amanecer'), section(23, 11, 'Brisas')],
  enrollments = [] as unknown[],
  quarterly = [] as unknown[],
  annual = [] as unknown[],
  dueDay = '5',
}: {
  profile?: any;
  coordinatorSections?: number[];
  sections?: unknown[];
  enrollments?: unknown[];
  quarterly?: unknown[];
  annual?: unknown[];
  dueDay?: string | null;
} = {}) {
  const prisma = {
    ecclesiastical_years: {
      findFirst: jest.fn().mockResolvedValue(YEAR),
      findUnique: jest.fn().mockResolvedValue(YEAR),
    },
    system_config: {
      findUnique: jest
        .fn()
        .mockResolvedValue(dueDay === null ? null : { config_value: dueDay }),
    },
    club_sections: { findMany: jest.fn().mockResolvedValue(sections) },
    club_enrollments: { findMany: jest.fn().mockResolvedValue(enrollments) },
    quarterly_reports: { findMany: jest.fn().mockResolvedValue(quarterly) },
    annual_reports: { findMany: jest.fn().mockResolvedValue(annual) },
  };
  const coordination = {
    getEffectiveCoordinatorSectionIds: jest
      .fn()
      .mockResolvedValue(coordinatorSections),
  };
  const service = new ReportsComplianceService(
    prisma as any,
    { resolveUserAuthorization: jest.fn().mockResolvedValue(profile) } as any,
    coordination as any,
  );
  return { service, prisma, coordination };
}

describe('report period helpers', () => {
  it('enumerates the 12 months of a calendar year with a due date on day N of the next month', () => {
    const months = monthlyPeriods(YEAR.start_date, YEAR.end_date, 5);

    expect(months).toHaveLength(12);
    expect(months[0]).toEqual({
      year: 2026,
      index: 1,
      endsAt: new Date('2026-02-01T00:00:00.000Z'),
      dueAt: new Date('2026-02-05T23:00:00.000Z'),
    });
    expect(months[11].dueAt).toEqual(new Date('2027-01-05T23:00:00.000Z'));
  });

  it('enumerates the 4 calendar quarters fully inside the year', () => {
    const quarters = quarterlyPeriods(YEAR.start_date, YEAR.end_date, 5);

    expect(quarters.map((q) => q.index)).toEqual([1, 2, 3, 4]);
    expect(quarters[0].endsAt).toEqual(new Date('2026-04-01T00:00:00.000Z'));
    expect(quarters[0].dueAt).toEqual(new Date('2026-04-05T23:00:00.000Z'));
  });

  it('skips a quarter that starts before the window', () => {
    const quarters = quarterlyPeriods(
      new Date('2026-02-01T00:00:00.000Z'),
      new Date('2026-12-31T00:00:00.000Z'),
      5,
    );

    expect(quarters.map((q) => q.index)).toEqual([2, 3, 4]);
  });

  it('classifies a period: open / pending until due / overdue after / submitted always', () => {
    const period = {
      endsAt: new Date('2026-04-01T00:00:00.000Z'),
      dueAt: new Date('2026-04-05T23:00:00.000Z'),
    };

    expect(classifyPeriod(period, false, new Date('2026-03-20'))).toBe(
      'not_due',
    );
    expect(classifyPeriod(period, false, new Date('2026-04-03'))).toBe(
      'pending',
    );
    expect(classifyPeriod(period, false, new Date('2026-04-06'))).toBe(
      'overdue',
    );
    expect(classifyPeriod(period, true, new Date('2026-03-20'))).toBe(
      'submitted',
    );
  });
});

describe('ReportsComplianceService', () => {
  const NOW = new Date('2026-04-03T12:00:00.000Z');

  it('limits a coordinator to the sections of their coordinator scope', async () => {
    const { service, prisma, coordination } = setup();

    await service.getCompliance('coord-user', {}, NOW);

    expect(coordination.getEffectiveCoordinatorSectionIds).toHaveBeenCalledWith(
      'coord-user',
    );
    expect(prisma.club_sections.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          active: true,
          AND: [{ clubs: { is: { active: true } } }],
          club_section_id: { in: [22, 23] },
        },
      }),
    );
    expect(prisma.club_enrollments.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          ecclesiastical_year_id: 1,
          status: 'active',
          club_section_id: { in: [22, 23] },
        },
      }),
    );
    expect(prisma.quarterly_reports.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ club_id: { in: [10, 11] } }),
      }),
    );
    expect(prisma.annual_reports.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { club_id: { in: [10, 11] }, ecclesiastical_year_id: 1 },
      }),
    );
  });

  it('a coordinator without assignments is 403 ADMIN_USER_SCOPE_MISSING', async () => {
    const { service, prisma } = setup({ coordinatorSections: [] });

    await expect(
      service.getCompliance('coord-user', {}, NOW),
    ).rejects.toMatchObject({ code: ErrorCode.ADMIN_USER_SCOPE_MISSING });
    expect(prisma.club_sections.findMany).not.toHaveBeenCalled();
  });

  it('a coordinator cannot widen the scope with territory filters', async () => {
    const { service, prisma } = setup();

    await service.getCompliance(
      'coord-user',
      { localFieldId: 999, unionId: 999, divisionId: 999 },
      NOW,
    );

    const where = prisma.club_sections.findMany.mock.calls[0][0].where;
    expect(where.club_section_id).toEqual({ in: [22, 23] });
    expect(where.clubs).toBeUndefined();
  });

  it('counts submitted / pending / overdue per club, per type and per period', async () => {
    const { service } = setup({
      enrollments: [
        {
          club_enrollment_id: 'e-22',
          club_section_id: 22,
          monthly_reports: [
            { year: 2026, month: 1, status: 'submitted' },
            { year: 2026, month: 2, status: 'generated' },
            { year: 2026, month: 3, status: 'submitted' },
          ],
        },
        {
          club_enrollment_id: 'e-23',
          club_section_id: 23,
          monthly_reports: [{ year: 2026, month: 1, status: 'draft' }],
        },
      ],
      quarterly: [
        { club_id: 10, year: 2026, quarter: 1, status: 'finalized' },
        { club_id: 11, year: 2026, quarter: 1, status: 'draft' },
      ],
    });

    // 2026-04-03: Jan and Feb are past their due date (Feb 5 / Mar 5),
    // March ended on Apr 1 and is due Apr 5 (pending), April is open.
    const data = await service.getCompliance('coord-user', {}, NOW);

    const [amanecer, brisas] = data.items;
    expect(amanecer.club_name).toBe('Amanecer');
    expect(amanecer.monthly).toEqual({
      expected: 3,
      submitted: 2,
      pending: 0,
      overdue: 1,
    });
    expect(brisas.monthly).toEqual({
      expected: 3,
      submitted: 0,
      pending: 1,
      overdue: 2,
    });
    // Q1 ended Apr 1, due Apr 5.
    expect(amanecer.quarterly).toEqual({
      expected: 1,
      submitted: 1,
      pending: 0,
      overdue: 0,
    });
    expect(brisas.quarterly).toEqual({
      expected: 1,
      submitted: 0,
      pending: 1,
      overdue: 0,
    });
    // The year is still open.
    expect(amanecer.annual).toEqual({
      expected: 0,
      submitted: 0,
      pending: 0,
      overdue: 0,
    });

    expect(data.totals.clubs).toBe(2);
    expect(data.totals.monthly).toMatchObject({
      expected: 6,
      submitted: 2,
      pending: 1,
      overdue: 3,
    });
    expect(data.totals.monthly.by_period[0]).toEqual({
      year: 2026,
      month: 1,
      due_at: '2026-02-05T23:00:00.000Z',
      expected: 2,
      submitted: 1,
      pending: 0,
      overdue: 1,
    });
    expect(data.totals.monthly.by_period[3]).toMatchObject({
      month: 4,
      expected: 0,
    });
    expect(data.totals.quarterly).toMatchObject({
      expected: 2,
      submitted: 1,
      pending: 1,
      overdue: 0,
    });
    expect(data.due_day).toBe(5);
  });

  it('counts annual reports once the year is over', async () => {
    const { service } = setup({
      annual: [{ club_id: 10, status: 'archived' }],
    });

    const data = await service.getCompliance(
      'coord-user',
      {},
      new Date('2027-02-01T00:00:00.000Z'),
    );

    expect(data.totals.annual).toEqual({
      expected: 2,
      submitted: 1,
      pending: 0,
      overdue: 1,
    });
  });

  it('narrows monthly and quarterly periods with month / quarter / year', async () => {
    const { service, prisma } = setup();

    const data = await service.getCompliance(
      'coord-user',
      { year: 2026, month: 2, quarter: 1 },
      NOW,
    );

    expect(data.totals.monthly.by_period.map((p) => p.month)).toEqual([2]);
    expect(data.totals.quarterly.by_period.map((p) => p.quarter)).toEqual([1]);
    expect(
      prisma.club_enrollments.findMany.mock.calls[0][0].select.monthly_reports
        .where,
    ).toEqual({ OR: [{ year: 2026, month: 2 }] });
  });

  it('an admin sees every club (no section filter) and may narrow by territory', async () => {
    const { service, prisma, coordination } = setup({
      profile: adminProfile(),
    });

    await service.getCompliance('admin-user', { localFieldId: 7 }, NOW);

    expect(
      coordination.getEffectiveCoordinatorSectionIds,
    ).not.toHaveBeenCalled();
    const where = prisma.club_sections.findMany.mock.calls[0][0].where;
    expect(where.club_section_id).toBeUndefined();
    expect(where.clubs).toEqual({ local_field_id: 7 });
  });

  it('paginates clubs while totals cover the whole scope', async () => {
    const { service } = setup();

    const data = await service.getCompliance(
      'coord-user',
      { page: 2, limit: 1 },
      NOW,
    );

    expect(data.total).toBe(2);
    expect(data.items.map((club) => club.club_name)).toEqual(['Brisas']);
    expect(data.totals.clubs).toBe(2);
  });

  it('rejects an out-of-range month or quarter', async () => {
    const { service } = setup();

    await expect(
      service.getCompliance('coord-user', { month: 13 }, NOW),
    ).rejects.toMatchObject({ code: ErrorCode.MONTHLY_REPORT_INVALID_MONTH });
    await expect(
      service.getCompliance('coord-user', { quarter: 5 }, NOW),
    ).rejects.toMatchObject({
      code: ErrorCode.QUARTERLY_REPORT_INVALID_QUARTER,
    });
  });

  it('404 when the ecclesiastical year does not exist', async () => {
    const { service, prisma } = setup();
    prisma.ecclesiastical_years.findUnique.mockResolvedValue(null);

    await expect(
      service.getCompliance('coord-user', { ecclesiasticalYearId: 77 }, NOW),
    ).rejects.toMatchObject({ code: ErrorCode.ANNUAL_REPORT_YEAR_NOT_FOUND });
  });

  it('falls back to due day 5 when the config is missing or invalid', async () => {
    const missing = setup({ dueDay: null });
    const invalid = setup({ dueDay: '31' });

    expect((await missing.service.getCompliance('u', {}, NOW)).due_day).toBe(5);
    expect((await invalid.service.getCompliance('u', {}, NOW)).due_day).toBe(5);
  });
});

describe('ReportsComplianceController', () => {
  it('is read-only: GET guarded by reports:read on an active_assignment resource', () => {
    const handler = ReportsComplianceController.prototype.getCompliance;

    expect(Reflect.getMetadata(PERMISSIONS_KEY, handler)).toEqual({
      permissions: ['reports:read'],
      mode: 'all',
    });
    expect(Reflect.getMetadata(AUTHORIZATION_RESOURCE_KEY, handler)).toEqual({
      type: 'active_assignment',
    });
  });
});
