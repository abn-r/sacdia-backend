import { AnnualReportsService } from './annual-reports.service';
import { ErrorCode } from '../common/errors/error-codes';
import { createFakeReportStore } from '../reports/fake-report-store.testing';
import type { PeriodicBaseData } from '../reports/periodic-report-data.service';
import { aggregateMonthlyData } from '../reports/periodic-monthly-data';

const utc = (iso: string) => new Date(`${iso}T00:00:00Z`);

// Ecclesiastical years that do NOT match calendar years (Oct-Sep).
const YEARS = [
  { year_id: 1, start_date: utc('2023-10-01'), end_date: utc('2024-09-30') },
  { year_id: 2, start_date: utc('2024-10-01'), end_date: utc('2025-09-30') },
  { year_id: 3, start_date: utc('2025-10-01'), end_date: utc('2026-09-30') },
];

const honor = (user: string, name: string, validate: boolean) => ({
  user_id: user,
  validate,
  users: { user_id: user, name, paternal_last_name: 'P' },
});

const baseData = (over: Partial<PeriodicBaseData> = {}): PeriodicBaseData => ({
  sectionIds: [7],
  memberCount: 5,
  directiva: [{ role: 'director', user_id: 'u1', name: 'Ana' }],
  honors: [
    honor('u1', 'Ana', true),
    honor('u1', 'Ana', true),
    honor('u2', 'Beto', true),
    honor('u3', 'Carla', false),
  ],
  activitiesTotal: 9,
  finance: {
    income: 1699,
    expenses: 170,
    net: 1529,
    movements: 4,
    balance: 2529,
  },
  monthly: aggregateMonthlyData([]),
  camporeesAttended: 2,
  ...over,
});

function build(opts: { grace?: number; base?: PeriodicBaseData } = {}) {
  const store = createFakeReportStore({
    idField: 'annual_report_id',
    keyFields: ['club_id', 'ecclesiastical_year_id'],
    compoundName: 'club_id_ecclesiastical_year_id',
  });
  const prisma: any = {
    annual_reports: store.delegate,
    clubs: {
      findUnique: jest.fn().mockResolvedValue({ club_id: 10, active: true }),
      findFirst: jest.fn().mockResolvedValue({ club_id: 10 }),
      findMany: jest.fn().mockResolvedValue([
        { club_id: 10, name: 'A', created_at: utc('2020-01-01') },
        { club_id: 11, name: 'B', created_at: utc('2020-01-01') },
      ]),
    },
    ecclesiastical_years: {
      findUnique: jest.fn(
        async ({ where }: any) =>
          YEARS.find((y) => y.year_id === where.year_id) ?? null,
      ),
      findFirst: jest.fn(
        async ({ where }: any) =>
          where.start_date?.lte ? YEARS[2] : YEARS[1] /* previous of current */,
      ),
      findMany: jest.fn(async ({ where }: any) =>
        YEARS.filter(
          (y) =>
            y.start_date >= where.start_date.gte &&
            y.end_date < where.end_date.lt,
        ),
      ),
    },
  };
  const data: any = {
    compute: jest.fn().mockResolvedValue(opts.base ?? baseData()),
    countReportedMonths: jest.fn().mockResolvedValue(6),
    getFreezeGraceDays: jest.fn().mockResolvedValue(opts.grace ?? 15),
  };
  const service = new AnnualReportsService(prisma, {} as any, undefined, data);
  return { service, store, prisma, data };
}

const at = (iso: string) => jest.useFakeTimers({ now: new Date(iso) });
afterEach(() => jest.useRealTimers());

describe('AnnualReportsService.computeData', () => {
  it('computes over the ecclesiastical year months, not the calendar year', async () => {
    const { service, data } = build();

    await service.computeData(10, 3);

    const period = data.compute.mock.calls[0][1];
    expect(period.months).toHaveLength(12);
    expect(period.months[0]).toEqual({ year: 2025, month: 10 });
    expect(period.months[11]).toEqual({ year: 2026, month: 9 });
    expect(period.endExclusiveDate).toEqual(utc('2026-10-01'));
  });

  it('keeps the structure and renders both the net and the cumulative balance', async () => {
    const { service } = build();

    const computed = await service.computeData(10, 3);

    expect(computed).toMatchObject({
      ecclesiastical_year_id: 3,
      year_label: '2025–2026',
      member_count: 5,
      months_reported: 6,
      directiva: [{ role: 'director', user_id: 'u1', name: 'Ana' }],
      honors: { started: 4, completed: 3 },
      activities: { total: 9 },
      finances: {
        income: 1699,
        expenses: 170,
        balance: 1529,
        total_balance: 2529,
        transactions: 4,
      },
    });
    expect(computed).not.toHaveProperty('ranking_percentile');
  });

  it('lists the top achievers by validated honors', async () => {
    const { service } = build();

    const { top_achievers } = await service.computeData(10, 3);

    expect(top_achievers).toEqual([
      { user_id: 'u1', name: 'Ana P', honors_count: 2 },
      { user_id: 'u2', name: 'Beto P', honors_count: 1 },
    ]);
  });

  it('maps the monthly data: sums, latest and null without submitted months', async () => {
    const withData = aggregateMonthlyData([
      {
        year: 2025,
        month: 11,
        manual_data: {
          planning_meetings: 2,
          parent_meetings: 1,
          youth_council_attendance: 0,
          church_board_attendance: 0,
          soul_target: 3,
          baptized_this_month: 2,
          total_baptized: 8,
          club_participation_description: null,
          community_service_description: 'Visita',
          certificates_delivered: false,
        },
      },
      {
        year: 2026,
        month: 2,
        manual_data: {
          planning_meetings: 1,
          parent_meetings: 1,
          youth_council_attendance: 0,
          church_board_attendance: 0,
          soul_target: 6,
          baptized_this_month: 1,
          total_baptized: 11,
          club_participation_description: null,
          community_service_description: null,
          certificates_delivered: false,
        },
      },
    ]);
    const a = await build({
      base: baseData({ monthly: withData }),
    }).service.computeData(10, 3);

    expect(a.monthly_data).toEqual({
      months_submitted: 2,
      months_covered: [
        { year: 2025, month: 11 },
        { year: 2026, month: 2 },
      ],
      planning_meetings: 3,
      parent_meetings: 2,
      baptized_this_year: 3,
      total_baptized: 11,
      annual_achievements_description: null,
      community_service_description: [
        { year: 2025, month: 11, text: 'Visita' },
      ],
      all_investitures_completed: null,
      camporees_attended: 2,
    });
    expect(a.missionary.baptized_total).toBe(3);

    const empty = await build().service.computeData(10, 3);
    expect(empty.monthly_data).toMatchObject({
      months_submitted: 0,
      planning_meetings: null,
      parent_meetings: null,
      baptized_this_year: null,
      total_baptized: null,
      community_service_description: null,
    });
    expect(empty.missionary.baptized_total).toBeNull();
  });

  it('404s for an unknown ecclesiastical year', async () => {
    await expect(build().service.computeData(10, 99)).rejects.toMatchObject({
      code: ErrorCode.ANNUAL_REPORT_YEAR_NOT_FOUND,
    });
  });
});

describe('AnnualReportsService lifecycle', () => {
  it('a draft is recomputed on read, conditionally on still being a draft', async () => {
    const { service, store } = build();
    await service.getOrCreateDraft(10, 3);

    await service.getReport(1);

    expect(store.delegate.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { annual_report_id: 1, status: 'draft' },
      }),
    );
    expect(store.rows[0].computed_data).toMatchObject({
      ecclesiastical_year_id: 3,
    });
  });

  it('freeze finalizes with no finalizer, only once, only from draft', async () => {
    const { service, store, data } = build();
    await service.getOrCreateDraft(10, 2);

    await expect(service.freezeReport(1)).resolves.toBe(true);
    expect(store.rows[0]).toMatchObject({
      status: 'finalized',
      finalized_by: null,
    });
    data.compute.mockClear();
    await expect(service.freezeReport(1)).resolves.toBe(false);
    expect(data.compute).not.toHaveBeenCalled();
  });

  it('a concurrent freeze is not overwritten by a stale refresh', async () => {
    const { service, store, data } = build();
    await service.getOrCreateDraft(10, 3);
    data.compute.mockImplementationOnce(async () => {
      Object.assign(store.rows[0], {
        status: 'finalized',
        computed_data: { frozen: true },
      });
      return baseData();
    });

    await service.refreshDraft(1);

    expect(store.rows[0].computed_data).toEqual({ frozen: true });
  });

  it('regenerate recomputes a finalized report and keeps it finalized', async () => {
    const { service, store } = build();
    store.rows.push({
      annual_report_id: 1,
      club_id: 10,
      ecclesiastical_year_id: 2,
      status: 'finalized',
      finalized_by: null,
      computed_data: { old: true },
    });

    await service.regenerate(1);

    expect(store.rows[0].status).toBe('finalized');
    expect(store.rows[0].computed_data).toMatchObject({
      ecclesiastical_year_id: 2,
    });
  });

  describe('generateOnDemand', () => {
    it('live draft while the year is open', async () => {
      at('2026-03-01T12:00:00Z');
      const report = await build().service.generateOnDemand(10, 3);
      expect(report.status).toBe('draft');
    });

    it('draft inside the grace window after the year ended', async () => {
      at('2026-10-10T12:00:00Z');
      const report = await build({ grace: 15 }).service.generateOnDemand(10, 3);
      expect(report.status).toBe('draft');
    });

    it('created frozen once past grace', async () => {
      at('2026-10-20T12:00:00Z');
      const report = await build({ grace: 15 }).service.generateOnDemand(10, 3);
      expect(report.status).toBe('finalized');
      expect(report.finalized_by).toBeNull();
    });

    it('rejects a year that has not started', async () => {
      at('2025-09-01T12:00:00Z');
      await expect(
        build().service.generateOnDemand(10, 3),
      ).rejects.toMatchObject({
        code: ErrorCode.REPORT_PERIOD_IN_FUTURE,
      });
    });
  });
});

describe('AnnualReportsService.freezeDueReports (daily catch-up)', () => {
  it('freezes the ecclesiastical year (Oct-Sep) once past grace, for every active club', async () => {
    const { service, store } = build();

    // 2025-10-20: year 2 ended 2025-09-30 (20 days ago > 15).
    const result = await service.freezeDueReports(
      15,
      new Date('2025-10-20T12:00:00Z'),
    );

    const frozen = store.rows
      .filter((r) => r.status === 'finalized')
      .map((r) => `${r.club_id}:${r.ecclesiastical_year_id}`)
      .sort();
    expect(frozen).toEqual(['10:2', '11:2']);
    expect(result).toEqual({ success: 2, skipped: 0, errors: 0 });
  });

  it('does not freeze inside the grace window', async () => {
    const { service, store } = build();

    await service.freezeDueReports(15, new Date('2025-10-10T12:00:00Z'));

    expect(store.rows).toHaveLength(0);
  });

  it('a calendar-year end (Dec 31) is irrelevant: nothing freezes in January', async () => {
    const { service, store } = build();

    await service.freezeDueReports(15, new Date('2026-01-20T12:00:00Z'));

    expect(store.rows.some((r) => r.ecclesiastical_year_id === 3)).toBe(false);
  });

  it('catches up every past year lacking a finalized report, within the history bound', async () => {
    const { service, store } = build();
    // Today is after year 3 ended; lower bound is the start of the previous year (2).
    // findFirst: current=YEARS[2] (lte), previous=YEARS[1] -> bound 2024-10-01.
    await service.freezeDueReports(15, new Date('2026-11-01T12:00:00Z'));

    const years = [
      ...new Set(store.rows.map((r) => r.ecclesiastical_year_id)),
    ].sort();
    expect(years).toEqual([2, 3]); // year 1 is older than the previous year: not regenerated
  });

  it('is idempotent and never recomputes a finalized year', async () => {
    const { service, store, data } = build();
    const now = new Date('2026-11-01T12:00:00Z');
    await service.freezeDueReports(15, now);
    const snapshot = JSON.stringify(store.rows);
    data.compute.mockClear();

    const second = await service.freezeDueReports(15, now);

    expect(second.success).toBe(0);
    expect(data.compute).not.toHaveBeenCalled();
    expect(JSON.stringify(store.rows)).toBe(snapshot);
  });

  it('keeps going when one club fails', async () => {
    const { service, data } = build();
    data.compute.mockImplementation(async (clubId: number) => {
      if (clubId === 10) throw new Error('boom');
      return baseData();
    });

    const result = await service.freezeDueReports(
      15,
      new Date('2025-10-20T12:00:00Z'),
    );

    expect(result).toEqual({ success: 1, skipped: 0, errors: 1 });
  });
});
