import { QuarterlyReportsService } from './quarterly-reports.service';
import { ErrorCode } from '../common/errors/error-codes';
import { createFakeReportStore } from '../reports/fake-report-store.testing';
import type { PeriodicBaseData } from '../reports/periodic-report-data.service';
import { aggregateMonthlyData } from '../reports/periodic-monthly-data';

const baseData = (over: Partial<PeriodicBaseData> = {}): PeriodicBaseData => ({
  sectionIds: [7],
  memberCount: 3,
  directiva: [{ role: 'director', user_id: 'u1', name: 'Ana' }],
  honors: [
    {
      user_id: 'u1',
      validate: true,
      users: { user_id: 'u1', name: 'Ana', paternal_last_name: 'P' },
    },
    {
      user_id: 'u2',
      validate: false,
      users: { user_id: 'u2', name: 'Beto', paternal_last_name: 'Q' },
    },
  ],
  activitiesTotal: 4,
  finance: {
    income: 900,
    expenses: 400,
    net: 500,
    movements: 6,
    balance: 4200,
  },
  monthly: aggregateMonthlyData([]),
  camporeesAttended: 1,
  ...over,
});

function build(opts: { grace?: number; base?: PeriodicBaseData } = {}) {
  const store = createFakeReportStore({
    idField: 'quarterly_report_id',
    keyFields: ['club_id', 'year', 'quarter'],
    compoundName: 'club_id_year_quarter',
  });
  const prisma: any = {
    quarterly_reports: store.delegate,
    clubs: {
      findUnique: jest.fn().mockResolvedValue({ club_id: 10, active: true }),
      findFirst: jest.fn().mockResolvedValue({ club_id: 10 }),
      findMany: jest.fn().mockResolvedValue([]),
    },
    ecclesiastical_years: { findFirst: jest.fn().mockResolvedValue(null) },
  };
  const auth: any = { resolveUserAuthorization: jest.fn() };
  const data: any = {
    compute: jest.fn().mockResolvedValue(opts.base ?? baseData()),
    getFreezeGraceDays: jest.fn().mockResolvedValue(opts.grace ?? 15),
  };
  const service = new QuarterlyReportsService(prisma, auth, undefined, data);
  return { service, store, prisma, auth, data };
}

const at = (iso: string) => jest.useFakeTimers({ now: new Date(iso) });

afterEach(() => jest.useRealTimers());

describe('QuarterlyReportsService.computeData', () => {
  it('maps the submitted monthly data onto the old manual fields', async () => {
    const monthly = aggregateMonthlyData([
      {
        year: 2026,
        month: 4,
        manual_data: {
          planning_meetings: 2,
          parent_meetings: 1,
          youth_council_attendance: 3,
          church_board_attendance: 4,
          soul_target: 5,
          baptized_this_month: 1,
          total_baptized: 10,
          club_participation_description: 'Feria',
          community_service_description: null,
          certificates_delivered: false,
        },
      },
      {
        year: 2026,
        month: 6,
        manual_data: {
          planning_meetings: 3,
          parent_meetings: 0,
          youth_council_attendance: 1,
          church_board_attendance: 2,
          soul_target: 8,
          baptized_this_month: 2,
          total_baptized: 12,
          club_participation_description: null,
          community_service_description: 'Limpieza',
          certificates_delivered: true,
        },
      },
    ]);
    const { service } = build({ base: baseData({ monthly }) });

    const data = await service.computeData(10, 2026, 2);

    expect(data.monthly_data).toEqual({
      months_submitted: 2,
      months_covered: [
        { year: 2026, month: 4 },
        { year: 2026, month: 6 },
      ],
      planning_meetings: 5,
      parent_meetings: 1,
      youth_council_attendance: 4,
      church_board_attendance: 6,
      soul_target: 8,
      baptized_this_quarter: 3,
      club_participation_description: [{ year: 2026, month: 4, text: 'Feria' }],
      community_service_description: [
        { year: 2026, month: 6, text: 'Limpieza' },
      ],
      certificates_delivered: true,
      camporees_attended: 1,
    });
    expect(data.missionary.baptized_this_quarter).toBe(3);
  });

  it('every monthly figure is null (not 0) when no monthly report was submitted', async () => {
    const { service } = build();

    const { monthly_data, missionary } = await service.computeData(10, 2026, 2);

    expect(monthly_data.months_submitted).toBe(0);
    expect(monthly_data.months_covered).toEqual([]);
    for (const key of [
      'planning_meetings',
      'parent_meetings',
      'youth_council_attendance',
      'church_board_attendance',
      'soul_target',
      'baptized_this_quarter',
      'club_participation_description',
      'community_service_description',
      'certificates_delivered',
    ] as const) {
      expect(monthly_data[key]).toBeNull();
    }
    expect(missionary.baptized_this_quarter).toBeNull();
  });

  it('keeps the structure: members, board, honors, activities and both balances', async () => {
    const { service, data } = build();

    const computed = await service.computeData(10, 2026, 2);

    expect(computed).toMatchObject({
      quarter_label: 'Q2 2026',
      months_in_quarter: [4, 5, 6],
      member_count: 3,
      directiva: [{ role: 'director', user_id: 'u1', name: 'Ana' }],
      honors: { started: 2, completed: 1 },
      activities: { total: 4 },
      finances: {
        income: 900,
        expenses: 400,
        balance: 500,
        total_balance: 4200,
        transactions: 6,
      },
    });
    expect(computed).not.toHaveProperty('ranking_percentile');
    expect(data.compute.mock.calls[0][1]).toMatchObject({
      startDate: new Date('2026-04-01T00:00:00Z'),
      endExclusiveDate: new Date('2026-07-01T00:00:00Z'),
    });
  });

  it('rejects an invalid quarter or year', async () => {
    const { service } = build();
    await expect(service.computeData(10, 2026, 5)).rejects.toMatchObject({
      code: ErrorCode.QUARTERLY_REPORT_INVALID_QUARTER,
    });
    await expect(service.computeData(10, 2019, 1)).rejects.toMatchObject({
      code: ErrorCode.QUARTERLY_REPORT_INVALID_YEAR,
    });
  });
});

describe('QuarterlyReportsService lifecycle', () => {
  describe('refreshDraft / getReport', () => {
    it('recomputes a draft on read and writes only while it is still a draft', async () => {
      const { service, store } = build();
      await service.getOrCreateDraft(10, 2026, 2);

      await service.getReport(1);

      expect(store.delegate.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { quarterly_report_id: 1, status: 'draft' },
        }),
      );
      expect(store.rows[0].computed_data).toMatchObject({ quarter: 2 });
      expect(store.rows[0].status).toBe('draft');
    });

    it('serves a finalized report as stored, without recomputing', async () => {
      const { service, store, data } = build();
      store.rows.push({
        quarterly_report_id: 1,
        club_id: 10,
        year: 2026,
        quarter: 1,
        status: 'finalized',
        computed_data: { frozen: true },
      });

      await service.getReport(1);

      expect(data.compute).not.toHaveBeenCalled();
      expect(store.delegate.updateMany).not.toHaveBeenCalled();
      expect(store.rows[0].computed_data).toEqual({ frozen: true });
    });

    it('a concurrent freeze is never overwritten by a stale refresh', async () => {
      const { service, store, data } = build();
      await service.getOrCreateDraft(10, 2026, 2);
      // The freeze lands while the refresh is computing.
      data.compute.mockImplementationOnce(async () => {
        Object.assign(store.rows[0], {
          status: 'finalized',
          computed_data: { frozen: true },
        });
        return baseData();
      });

      await service.refreshDraft(1);

      expect(store.rows[0].computed_data).toEqual({ frozen: true });
      expect(store.rows[0].status).toBe('finalized');
    });

    it('answers 404 for an unknown report', async () => {
      const { service } = build();
      await expect(service.getReport(99)).rejects.toMatchObject({
        code: ErrorCode.QUARTERLY_REPORT_NOT_FOUND,
      });
    });
  });

  describe('freezeReport', () => {
    it('finalizes a draft with no finalizer (automatic)', async () => {
      const { service, store } = build();
      await service.getOrCreateDraft(10, 2026, 1);

      await expect(service.freezeReport(1)).resolves.toBe(true);

      expect(store.rows[0]).toMatchObject({
        status: 'finalized',
        finalized_by: null,
        computed_data: expect.objectContaining({ quarter: 1 }),
      });
      expect(store.rows[0].finalized_at).toBeInstanceOf(Date);
      expect(store.delegate.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { quarterly_report_id: 1, status: 'draft' },
        }),
      );
    });

    it('is idempotent: a second freeze changes nothing', async () => {
      const { service, store, data } = build();
      await service.getOrCreateDraft(10, 2026, 1);
      await service.freezeReport(1);
      const snapshot = { ...store.rows[0] };
      data.compute.mockClear();

      await expect(service.freezeReport(1)).resolves.toBe(false);

      expect(data.compute).not.toHaveBeenCalled();
      expect(store.rows[0]).toEqual(snapshot);
    });

    it('does not report a freeze it lost to a concurrent one', async () => {
      const { service, store, data } = build();
      await service.getOrCreateDraft(10, 2026, 1);
      data.compute.mockImplementationOnce(async () => {
        Object.assign(store.rows[0], { status: 'finalized' });
        return baseData();
      });

      await expect(service.freezeReport(1)).resolves.toBe(false);
    });
  });

  describe('regenerate (support escape hatch)', () => {
    it('recomputes a finalized report and keeps it finalized', async () => {
      const { service, store } = build();
      store.rows.push({
        quarterly_report_id: 1,
        club_id: 10,
        year: 2026,
        quarter: 1,
        status: 'finalized',
        finalized_by: null,
        computed_data: { old: true },
      });

      await service.regenerate(1);

      expect(store.rows[0].status).toBe('finalized');
      expect(store.rows[0].computed_data).toMatchObject({ quarter: 1 });
      expect(store.delegate.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { quarterly_report_id: 1, status: 'finalized' },
        }),
      );
    });

    it('keeps a draft a draft', async () => {
      const { service, store } = build();
      await service.getOrCreateDraft(10, 2026, 2);

      await service.regenerate(1);

      expect(store.rows[0].status).toBe('draft');
    });

    it('retries once when a draft was frozen while it computed', async () => {
      const { service, store, data } = build();
      await service.getOrCreateDraft(10, 2026, 2);
      data.compute.mockImplementationOnce(async () => {
        Object.assign(store.rows[0], { status: 'finalized' });
        return baseData();
      });

      await service.regenerate(1);

      expect(store.rows[0].status).toBe('finalized');
      expect(store.rows[0].computed_data).toMatchObject({ quarter: 2 });
    });

    it('404s for an unknown report', async () => {
      const { service } = build();
      await expect(service.regenerate(9)).rejects.toMatchObject({
        code: ErrorCode.QUARTERLY_REPORT_NOT_FOUND,
      });
    });
  });

  describe('generateOnDemand', () => {
    it('creates the draft and computes it live while the quarter is open', async () => {
      at('2026-05-10T12:00:00Z');
      const { service, store } = build();

      const report = await service.generateOnDemand(10, 2026, 2);

      expect(store.rows).toHaveLength(1);
      expect(report.status).toBe('draft');
      expect(store.rows[0].computed_data).toMatchObject({ quarter: 2 });
    });

    it('stays a draft inside the grace window after the quarter ended', async () => {
      at('2026-07-10T12:00:00Z');
      const { service } = build({ grace: 15 });

      const report = await service.generateOnDemand(10, 2026, 2);

      expect(report.status).toBe('draft');
    });

    it('is created frozen when the quarter is past the grace period', async () => {
      at('2026-07-20T12:00:00Z');
      const { service } = build({ grace: 15 });

      const report = await service.generateOnDemand(10, 2026, 2);

      expect(report.status).toBe('finalized');
      expect(report.finalized_by).toBeNull();
    });

    it('freezes an existing stale draft of a period past grace', async () => {
      at('2026-08-01T12:00:00Z');
      const { service, store } = build();
      await service.getOrCreateDraft(10, 2026, 2);

      const report = await service.generateOnDemand(10, 2026, 2);

      expect(store.rows).toHaveLength(1);
      expect(report.status).toBe('finalized');
    });

    it('returns a finalized report untouched', async () => {
      at('2026-08-01T12:00:00Z');
      const { service, store, data } = build();
      store.rows.push({
        quarterly_report_id: 1,
        club_id: 10,
        year: 2026,
        quarter: 2,
        status: 'finalized',
        computed_data: { frozen: true },
      });

      await service.generateOnDemand(10, 2026, 2);

      expect(data.compute).not.toHaveBeenCalled();
      expect(store.rows[0].computed_data).toEqual({ frozen: true });
    });

    it('reads the row created by a concurrent request instead of failing', async () => {
      at('2026-05-10T12:00:00Z');
      const { service, store } = build();
      const realFind = store.delegate.findUnique.getMockImplementation()!;
      // First lookup misses, then the winner's row appears before create.
      store.delegate.findUnique.mockImplementationOnce(async () => {
        store.rows.push({
          quarterly_report_id: 1,
          club_id: 10,
          year: 2026,
          quarter: 2,
          status: 'draft',
          computed_data: null,
        });
        return null;
      });
      store.delegate.findUnique.mockImplementation(realFind);

      await expect(
        service.generateOnDemand(10, 2026, 2),
      ).resolves.toMatchObject({
        quarterly_report_id: 1,
      });
      expect(store.rows).toHaveLength(1);
    });

    it('rejects a quarter that starts after today', async () => {
      at('2026-05-10T12:00:00Z');
      const { service } = build();
      await expect(service.generateOnDemand(10, 2026, 3)).rejects.toMatchObject(
        {
          code: ErrorCode.REPORT_PERIOD_IN_FUTURE,
        },
      );
    });

    it('uses the Mexico City calendar day at the quarter boundary', async () => {
      // 03:00Z on Oct 1 is still Sep 30 evening in Mexico City.
      at('2026-10-01T03:00:00Z');
      const { service } = build();
      await expect(service.generateOnDemand(10, 2026, 4)).rejects.toMatchObject(
        {
          code: ErrorCode.REPORT_PERIOD_IN_FUTURE,
        },
      );
    });
  });
});

describe('QuarterlyReportsService.freezeDueReports (daily catch-up)', () => {
  const clubs = [
    { club_id: 10, name: 'A', created_at: new Date('2020-01-01T00:00:00Z') },
    { club_id: 11, name: 'B', created_at: new Date('2020-01-01T00:00:00Z') },
  ];

  function withCatchUp(opts: Parameters<typeof build>[0] = {}) {
    const ctx = build(opts);
    ctx.prisma.clubs.findMany.mockResolvedValue(clubs);
    // Ecclesiastical years: Oct-Sep. Current = 2025-10-01.., previous = 2024-10-01..
    ctx.prisma.ecclesiastical_years.findFirst.mockImplementation(
      async ({ where }: any) => {
        if (where.start_date?.lte) {
          return { start_date: new Date('2025-10-01T00:00:00Z') };
        }
        return { start_date: new Date('2024-10-01T00:00:00Z') };
      },
    );
    return ctx;
  }

  it('freezes only quarters past grace, from the previous ecclesiastical year on', async () => {
    const { service, store } = withCatchUp();

    // 2026-04-20: Q1 2026 ended Mar 31 (20 days ago > 15) -> due. Q2 still open.
    const result = await service.freezeDueReports(
      15,
      new Date('2026-04-20T12:00:00Z'),
    );

    const frozen = store.rows
      .filter((r) => r.status === 'finalized')
      .map((r) => `${r.club_id}:${r.year}Q${r.quarter}`)
      .sort();
    // Lower bound is 2024-10-01 -> Q4 2024 .. Q1 2026, 2 clubs each.
    expect(frozen).toContain('10:2026Q1');
    expect(frozen).toContain('11:2026Q1');
    expect(frozen).toContain('10:2024Q4');
    expect(frozen.some((k) => k.includes('2024Q3'))).toBe(false);
    expect(frozen.some((k) => k.includes('2026Q2'))).toBe(false);
    expect(result.success).toBe(frozen.length);
    expect(result.success).toBe(2 * 6);
    expect(result.errors).toBe(0);
  });

  it('waits out the grace window: a quarter that ended 10 days ago is not frozen yet', async () => {
    const { service, store } = withCatchUp();

    await service.freezeDueReports(15, new Date('2026-04-10T12:00:00Z'));

    expect(store.rows.some((r) => r.year === 2026 && r.quarter === 1)).toBe(
      false,
    );
    expect(store.rows.some((r) => r.year === 2025 && r.quarter === 4)).toBe(
      true,
    );
  });

  it('a larger grace pushes the freeze back', async () => {
    const { service, store } = withCatchUp();

    await service.freezeDueReports(30, new Date('2026-04-20T12:00:00Z'));

    expect(store.rows.some((r) => r.year === 2026 && r.quarter === 1)).toBe(
      false,
    );
  });

  it('is idempotent: a second run freezes nothing and never recomputes finalized rows', async () => {
    const { service, store, data } = withCatchUp();
    const now = new Date('2026-04-20T12:00:00Z');
    await service.freezeDueReports(15, now);
    const snapshot = JSON.stringify(store.rows);
    data.compute.mockClear();

    const second = await service.freezeDueReports(15, now);

    expect(second.success).toBe(0);
    expect(data.compute).not.toHaveBeenCalled();
    expect(JSON.stringify(store.rows)).toBe(snapshot);
  });

  it('completes a draft left by a previous partial run', async () => {
    const { service, store } = withCatchUp();
    store.rows.push({
      quarterly_report_id: 100,
      club_id: 10,
      year: 2026,
      quarter: 1,
      status: 'draft',
      computed_data: null,
    });
    store.delegate.create.mockClear();

    await service.freezeDueReports(15, new Date('2026-04-20T12:00:00Z'));

    expect(store.rows.find((r) => r.quarterly_report_id === 100)!.status).toBe(
      'finalized',
    );
  });

  it('keeps going when one club fails', async () => {
    const { service, store, data } = withCatchUp();
    data.compute.mockImplementation(async (clubId: number) => {
      if (clubId === 10) throw new Error('boom');
      return baseData();
    });

    const result = await service.freezeDueReports(
      15,
      new Date('2026-04-20T12:00:00Z'),
    );

    expect(result.errors).toBe(6);
    expect(result.success).toBe(6);
    expect(
      store.rows.filter((r) => r.club_id === 11 && r.status === 'finalized'),
    ).toHaveLength(6);
  });

  it('skips quarters before the club existed', async () => {
    const { service, store, prisma } = withCatchUp();
    prisma.clubs.findMany.mockResolvedValue([
      {
        club_id: 12,
        name: 'New',
        created_at: new Date('2026-02-10T00:00:00Z'),
      },
    ]);

    await service.freezeDueReports(15, new Date('2026-04-20T12:00:00Z'));

    const periods = store.rows.map((r) => `${r.year}Q${r.quarter}`);
    expect(periods).toEqual(['2026Q1']);
  });

  it('does nothing when no ecclesiastical year has started', async () => {
    const { service, prisma, store } = build();
    prisma.ecclesiastical_years.findFirst.mockResolvedValue(null);

    const result = await service.freezeDueReports(
      15,
      new Date('2026-04-20T12:00:00Z'),
    );

    expect(result).toEqual({ success: 0, skipped: 0, errors: 0 });
    expect(store.rows).toHaveLength(0);
  });
});
