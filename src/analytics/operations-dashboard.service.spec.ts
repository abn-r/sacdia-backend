import { ErrorCode } from '../common/errors/error-codes';
import { OperationsDashboardService } from './operations-dashboard.service';
import type {
  EcclesiasticalYearRecord,
  OperationsDashboardRawSnapshot,
  ResolvedOperationsDashboardScope,
} from './operations-dashboard.types';

const activeYear: EcclesiasticalYearRecord = {
  year_id: 7,
  start_date: new Date('2026-01-01T00:00:00.000Z'),
  end_date: new Date('2026-12-31T00:00:00.000Z'),
  active: true,
};

const historicalYear: EcclesiasticalYearRecord = {
  year_id: 6,
  start_date: new Date('2025-01-01T00:00:00.000Z'),
  end_date: new Date('2025-12-31T00:00:00.000Z'),
  active: false,
};

const crossCalendarYear: EcclesiasticalYearRecord = {
  year_id: 9,
  start_date: new Date('2025-10-15T00:00:00.000Z'),
  end_date: new Date('2026-09-20T00:00:00.000Z'),
  active: true,
};

const globalScope: ResolvedOperationsDashboardScope = {
  level: 'all',
  id: null,
  name: 'Todos',
  path: [],
};

const emptyRaw = (): OperationsDashboardRawSnapshot => ({
  children: [],
  administrative: [],
  operations: [],
  people: [],
  classes: [],
  monthlyReports: [],
  honors: [],
  activities: [],
  queues: [],
});

describe('OperationsDashboardService', () => {
  const scopeService = { resolve: jest.fn() };
  const repository = {
    findActiveEcclesiasticalYear: jest.fn(),
    findEcclesiasticalYearById: jest.fn(),
    loadSnapshot: jest.fn(),
  };

  let service: OperationsDashboardService;

  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(new Date('2026-07-15T12:00:00.000Z'));
    jest.clearAllMocks();
    service = new OperationsDashboardService(
      scopeService as any,
      repository as any,
    );
    scopeService.resolve.mockResolvedValue(globalScope);
    repository.findActiveEcclesiasticalYear.mockResolvedValue(activeYear);
    repository.findEcclesiasticalYearById.mockResolvedValue(activeYear);
    repository.loadSnapshot.mockResolvedValue(emptyRaw());
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('resolves the active year and the last closed calendar month by default', async () => {
    const result = await service.getDashboard('actor', {});

    expect(repository.findActiveEcclesiasticalYear).toHaveBeenCalledTimes(1);
    expect(repository.findEcclesiasticalYearById).not.toHaveBeenCalled();
    expect(repository.loadSnapshot).toHaveBeenCalledWith({
      scope: globalScope,
      ecclesiasticalYear: activeYear,
      reportingMonth: { year: 2026, month: 6 },
      includeHonors: true,
    });
    expect(result.meta.period.reporting_month).toEqual({
      year: 2026,
      month: 6,
    });
  });

  it('throws a canonical 404 when there is no active ecclesiastical year', async () => {
    repository.findActiveEcclesiasticalYear.mockResolvedValue(null);

    await expect(service.getDashboard('actor', {})).rejects.toMatchObject({
      code: ErrorCode.ADMIN_ECCLESIASTICAL_YEAR_NOT_FOUND,
      status: 404,
    });
    expect(repository.loadSnapshot).not.toHaveBeenCalled();
  });

  it('resolves an explicit ecclesiastical year and defaults to its last closed month', async () => {
    repository.findEcclesiasticalYearById.mockResolvedValue(historicalYear);

    const result = await service.getDashboard('actor', {
      ecclesiastical_year_id: 6,
    });

    expect(repository.findEcclesiasticalYearById).toHaveBeenCalledWith(6);
    expect(result.meta.period.reporting_month).toEqual({
      year: 2025,
      month: 12,
    });
    expect(repository.loadSnapshot).toHaveBeenCalledWith(
      expect.objectContaining({ includeHonors: false }),
    );
    expect(result.summary.honors).toEqual({
      in_progress: null,
      pending_review: null,
      approved: null,
      attribution: 'unavailable',
    });
  });

  it('uses explicit paired report period without replacing it', async () => {
    const result = await service.getDashboard('actor', {
      report_year: 2026,
      report_month: 2,
    });

    expect(result.meta.period.reporting_month).toEqual({
      year: 2026,
      month: 2,
    });
  });

  it.each([
    { report_year: 2025, report_month: 9, edge: 'before start' },
    { report_year: 2026, report_month: 10, edge: 'after end' },
  ])(
    'rejects an explicit reporting month $edge of the ecclesiastical year',
    async ({ report_year, report_month }) => {
      repository.findEcclesiasticalYearById.mockResolvedValue(
        crossCalendarYear,
      );

      await expect(
        service.getDashboard('actor', {
          ecclesiastical_year_id: crossCalendarYear.year_id,
          report_year,
          report_month,
        }),
      ).rejects.toMatchObject({
        code: 'ANALYTICS_REPORTING_PERIOD_OUTSIDE_ECCLESIASTICAL_YEAR',
        status: 400,
      });
    },
  );

  it('accepts both inclusive reporting-month boundaries of a cross-calendar year', async () => {
    repository.findEcclesiasticalYearById.mockResolvedValue(crossCalendarYear);

    const start = await service.getDashboard('actor', {
      ecclesiastical_year_id: crossCalendarYear.year_id,
      report_year: 2025,
      report_month: 10,
    });
    const end = await service.getDashboard('actor', {
      ecclesiastical_year_id: crossCalendarYear.year_id,
      report_year: 2026,
      report_month: 9,
    });

    expect(start.meta.period.reporting_month).toEqual({
      year: 2025,
      month: 10,
    });
    expect(end.meta.period.reporting_month).toEqual({
      year: 2026,
      month: 9,
    });
    expect(repository.loadSnapshot).toHaveBeenCalledTimes(2);
  });

  it('returns a non-applicable reporting period when the new year has no closed month', async () => {
    const newlyOpenedYear: EcclesiasticalYearRecord = {
      year_id: 8,
      start_date: new Date('2026-07-01T00:00:00.000Z'),
      end_date: new Date('2027-06-30T00:00:00.000Z'),
      active: true,
    };
    repository.findActiveEcclesiasticalYear.mockResolvedValue(newlyOpenedYear);

    const result = await service.getDashboard('actor', {});

    expect(repository.loadSnapshot).toHaveBeenCalledWith(
      expect.objectContaining({ reportingMonth: null }),
    );
    expect(result.meta.period.reporting_month).toBeNull();
    expect(result.summary.monthly_reports).toEqual({
      expected_sections: 0,
      submitted_sections: 0,
      draft_sections: 0,
      generated_sections: 0,
      missing_sections: 0,
      coverage_pct: null,
    });
    expect(result.data_quality).toContainEqual(
      expect.objectContaining({
        metric: 'monthly_reports',
        status: 'not_applicable',
      }),
    );
  });

  it('marks cache hits without changing computed_at and keys by period', async () => {
    const first = await service.getDashboard('actor', {
      report_year: 2026,
      report_month: 6,
    });
    jest.setSystemTime(new Date('2026-07-15T12:00:20.000Z'));
    const cached = await service.getDashboard('actor', {
      report_year: 2026,
      report_month: 6,
    });
    const otherPeriod = await service.getDashboard('actor', {
      report_year: 2026,
      report_month: 5,
    });

    expect(repository.loadSnapshot).toHaveBeenCalledTimes(2);
    expect(first.meta.cached).toBe(false);
    expect(cached.meta.cached).toBe(true);
    expect(cached.meta.computed_at).toBe(first.meta.computed_at);
    expect(otherPeriod.meta.cached).toBe(false);
  });

  it('expires cache entries after 60 seconds', async () => {
    await service.getDashboard('actor', {});
    jest.setSystemTime(new Date('2026-07-15T12:01:01.000Z'));
    const refreshed = await service.getDashboard('actor', {});

    expect(repository.loadSnapshot).toHaveBeenCalledTimes(2);
    expect(refreshed.meta.cached).toBe(false);
  });
});
