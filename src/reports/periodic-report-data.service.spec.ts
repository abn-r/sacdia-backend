import {
  PeriodicReportDataService,
  parseFreezeGraceDays,
} from './periodic-report-data.service';
import { quarterPeriod } from './periodic-report-period';

function build(overrides: Record<string, unknown> = {}) {
  const prisma: any = {
    system_config: { findUnique: jest.fn().mockResolvedValue(null) },
    club_role_assignments: { findMany: jest.fn().mockResolvedValue([]) },
    users_honors: { findMany: jest.fn().mockResolvedValue([]) },
    activities: { count: jest.fn().mockResolvedValue(0) },
    monthly_reports: { findMany: jest.fn().mockResolvedValue([]) },
    camporee_clubs: { findMany: jest.fn().mockResolvedValue([]) },
    ...overrides,
  };
  const finance: any = {
    getClubSectionIds: jest.fn().mockResolvedValue([7, 8]),
    aggregate: jest.fn().mockResolvedValue({
      income: 0,
      expenses: 0,
      net: 0,
      movements: 0,
      balance: 0,
    }),
  };
  return {
    prisma,
    finance,
    service: new PeriodicReportDataService(prisma, finance),
  };
}

/** Members query answers one person; the board query (role filter) none. */
function membersOnly(prisma: any) {
  prisma.club_role_assignments.findMany.mockImplementation(async (args: any) =>
    args.where.roles ? [] : [{ user_id: 'u1' }],
  );
}

describe('PeriodicReportDataService', () => {
  const q2 = quarterPeriod(2026, 2);

  it('feeds EVERY figure the same section set (all sections of the club, active or not)', async () => {
    const { prisma, finance, service } = build();
    membersOnly(prisma);

    await service.compute(10, q2);

    expect(finance.getClubSectionIds).toHaveBeenCalledTimes(1);
    expect(finance.getClubSectionIds).toHaveBeenCalledWith(10);
    // members + board
    for (const [args] of prisma.club_role_assignments.findMany.mock.calls) {
      expect(args.where.club_section_id).toEqual({ in: [7, 8] });
    }
    expect(
      prisma.activities.count.mock.calls[0][0].where.club_section_id,
    ).toEqual({ in: [7, 8] });
    expect(finance.aggregate.mock.calls[0][0]).toEqual([7, 8]);
    expect(
      prisma.monthly_reports.findMany.mock.calls[0][0].where.club_enrollment,
    ).toEqual({ club_section_id: { in: [7, 8] } });
    expect(
      prisma.camporee_clubs.findMany.mock.calls[0][0].where.club_section_id,
    ).toEqual({ in: [7, 8] });
  });

  it('uses half-open ranges so the last day of the period counts', async () => {
    const { prisma, service } = build();
    membersOnly(prisma);

    await service.compute(10, q2);

    const members =
      prisma.club_role_assignments.findMany.mock.calls[0][0].where;
    expect(members.start_date).toEqual({
      lt: new Date('2026-07-01T00:00:00Z'),
    });
    expect(members.AND).toContainEqual({
      OR: [
        { end_date: null },
        { end_date: { gte: new Date('2026-04-01T00:00:00Z') } },
      ],
    });
    expect(prisma.users_honors.findMany.mock.calls[0][0].where.date).toEqual({
      gte: new Date('2026-04-01T00:00:00Z'),
      lt: new Date('2026-07-01T00:00:00Z'),
    });
    expect(prisma.activities.count.mock.calls[0][0].where.created_at).toEqual({
      gte: new Date('2026-04-01T06:00:00Z'),
      lt: new Date('2026-07-01T06:00:00Z'),
    });
  });

  it('the board of the period does not require an active assignment', async () => {
    const { prisma, service } = build();

    await service.compute(10, q2);

    const boardWhere = prisma.club_role_assignments.findMany.mock.calls.find(
      ([args]: any[]) => args.where.roles,
    )[0].where;
    expect(boardWhere).not.toHaveProperty('active');
    expect(boardWhere).not.toHaveProperty('ecclesiastical_year_id');
    expect(boardWhere.start_date).toEqual({
      lt: new Date('2026-07-01T00:00:00Z'),
    });
  });

  it('lists a former board member and a successor, one entry per person and role', async () => {
    const { prisma, service } = build();
    const user = (id: string, name: string) => ({
      user_id: id,
      name,
      paternal_last_name: 'X',
      maternal_last_name: null,
    });
    prisma.club_role_assignments.findMany.mockImplementation(
      async (args: any) =>
        args.where.roles
          ? [
              { users: user('u2', 'Beto'), roles: { role_name: 'secretary' } },
              { users: user('u1', 'Ana'), roles: { role_name: 'director' } },
              { users: user('u3', 'Carla'), roles: { role_name: 'director' } },
              // same person and role in two sections/rows: once
              { users: user('u1', 'Ana'), roles: { role_name: 'director' } },
            ]
          : [],
    );

    const data = await service.compute(10, q2);

    expect(data.directiva.map((m) => `${m.role}:${m.user_id}`)).toEqual([
      'director:u1',
      'director:u3',
      'secretary:u2',
    ]);
  });

  it('asks only for SUBMITTED monthly reports of the months of the period', async () => {
    const { prisma, service } = build();

    await service.compute(10, q2);

    const where = prisma.monthly_reports.findMany.mock.calls[0][0].where;
    expect(where.status).toBe('submitted');
    expect(where.OR).toEqual([
      { year: 2026, month: 4 },
      { year: 2026, month: 5 },
      { year: 2026, month: 6 },
    ]);
  });

  it('aggregates what the monthly reports return and null-fills when there are none', async () => {
    const { prisma, service } = build();
    expect((await service.compute(10, q2)).monthly.baptized).toBeNull();

    prisma.monthly_reports.findMany.mockResolvedValue([
      {
        year: 2026,
        month: 5,
        manual_data: {
          planning_meetings: 2,
          parent_meetings: 0,
          youth_council_attendance: 0,
          church_board_attendance: 0,
          soul_target: 4,
          baptized_this_month: 3,
          total_baptized: 9,
          club_participation_description: null,
          community_service_description: null,
          certificates_delivered: true,
        },
      },
    ]);
    const data = await service.compute(10, q2);
    expect(data.monthly).toMatchObject({
      months_submitted: 1,
      planning_meetings: 2,
      baptized: 3,
      total_baptized: 9,
      certificates_delivered: true,
    });
  });

  it('counts DISTINCT camporees (local and union) registered by the sections', async () => {
    const { prisma, service } = build();
    prisma.camporee_clubs.findMany.mockResolvedValue([
      { camporee_id: 1, union_camporee_id: null },
      { camporee_id: 1, union_camporee_id: null }, // second section, same camporee
      { camporee_id: null, union_camporee_id: 1 }, // union id 1 is not local id 1
    ]);

    const data = await service.compute(10, q2);

    expect(data.camporeesAttended).toBe(2);
    const where = prisma.camporee_clubs.findMany.mock.calls[0][0].where;
    expect(where.status).toEqual({ in: ['registered', 'approved'] });
    expect(where.active).toBe(true);
    const dates = {
      active: true,
      start_date: {
        gte: new Date('2026-04-01T00:00:00Z'),
        lt: new Date('2026-07-01T00:00:00Z'),
      },
    };
    expect(where.OR).toEqual([
      { local_camporees: { is: dates } },
      { union_camporees: { is: dates } },
    ]);
  });

  it('a club without sections yields zeros and nulls without touching the database', async () => {
    const { prisma, finance, service } = build();
    finance.getClubSectionIds.mockResolvedValue([]);

    const data = await service.compute(10, q2);

    expect(data.memberCount).toBe(0);
    expect(data.camporeesAttended).toBe(0);
    expect(data.monthly.months_submitted).toBe(0);
    expect(prisma.club_role_assignments.findMany).not.toHaveBeenCalled();
    expect(prisma.monthly_reports.findMany).not.toHaveBeenCalled();
  });

  it('finance covers the first to the last month of the period', async () => {
    const { finance, service } = build();
    await service.compute(10, q2);
    expect(finance.aggregate).toHaveBeenCalledWith([7, 8], {
      from: { year: 2026, month: 4 },
      to: { year: 2026, month: 6 },
    });
  });

  describe('grace days', () => {
    it.each([
      ['15', 15],
      ['0', 0],
      ['30', 30],
      [undefined, 15],
      [null, 15],
      ['', 15],
      ['abc', 15],
      ['-3', 15],
      ['2.5', 15],
    ])('parses %p as %p', (raw, expected) => {
      expect(parseFreezeGraceDays(raw as string | undefined)).toBe(expected);
    });

    it('reads reports.periodic_freeze_grace_days from system_config', async () => {
      const { prisma, service } = build();
      prisma.system_config.findUnique.mockResolvedValue({ config_value: '20' });

      await expect(service.getFreezeGraceDays()).resolves.toBe(20);
      expect(prisma.system_config.findUnique).toHaveBeenCalledWith({
        where: { config_key: 'reports.periodic_freeze_grace_days' },
      });
    });
  });
});
