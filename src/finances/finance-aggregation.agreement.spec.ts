import { FinanceAggregationService } from './finance-aggregation.service';
import { FinancesService } from './finances.service';
import { MonthlyReportsService } from '../monthly-reports/monthly-reports.service';
import { QuarterlyReportsService } from '../quarterly-reports/quarterly-reports.service';
import { AnnualReportsService } from '../annual-reports/annual-reports.service';

/**
 * The club summary and the monthly, quarterly and annual reports must show the
 * same numbers for the same period. They all read the shared aggregation, so
 * this runs the REAL FinanceAggregationService over one in-memory ledger and
 * compares what each consumer reports.
 */
describe('finance totals agree across summary and reports', () => {
  type Row = {
    section: number;
    year: number;
    month: number;
    type: 0 | 1;
    amount: number;
    active: boolean;
  };

  const ledger: Row[] = [
    // Previous year: only counts in the all-time balance.
    { section: 10, year: 2025, month: 11, type: 0, amount: 1000, active: true },
    // Q2 2026
    { section: 10, year: 2026, month: 4, type: 0, amount: 500, active: true },
    { section: 10, year: 2026, month: 4, type: 1, amount: 120, active: true },
    { section: 10, year: 2026, month: 5, type: 0, amount: 200, active: true },
    { section: 10, year: 2026, month: 6, type: 1, amount: 50, active: true },
    // Later in the year (not in Q2).
    { section: 10, year: 2026, month: 7, type: 0, amount: 999, active: true },
    // Deactivated: ignored everywhere.
    { section: 10, year: 2026, month: 4, type: 0, amount: 7777, active: false },
    // Another club's section: ignored for section 10.
    { section: 99, year: 2026, month: 4, type: 0, amount: 5555, active: true },
  ];

  /** Fake `$queryRaw` that evaluates the aggregate query over the ledger. */
  const queryRaw = jest.fn(
    async (_strings: TemplateStringsArray, ...values: unknown[]) => {
      const keys = values.filter((v): v is number => typeof v === 'number');
      const ids = (
        values.find(
          (v) => typeof v === 'object' && v !== null && 'values' in v,
        ) as { values: number[] }
      ).values;
      const fromKey = keys[0];
      const toKey = keys[keys.length - 1];

      const rows = ledger.filter(
        (r) =>
          r.active &&
          ids.includes(r.section) &&
          r.year * 100 + r.month <= toKey,
      );
      const inRange = rows.filter((r) => r.year * 100 + r.month >= fromKey);
      const sum = (list: Row[], type: 0 | 1) =>
        list.filter((r) => r.type === type).reduce((s, r) => s + r.amount, 0);
      return [
        {
          income: BigInt(sum(inRange, 0)),
          expenses: BigInt(sum(inRange, 1)),
          movements: BigInt(inRange.length),
          balance: BigInt(sum(rows, 0) - sum(rows, 1)),
        },
      ];
    },
  );

  const prisma = {
    $queryRaw: queryRaw,
    clubs: {
      findUnique: jest.fn().mockResolvedValue({
        club_id: 1,
        name: 'ACV',
        club_sections: [
          { club_section_id: 10, club_types: { name: 'Conquistadores' } },
        ],
      }),
    },
    club_sections: {
      findMany: jest.fn().mockResolvedValue([{ club_section_id: 10 }]),
    },
    ecclesiastical_years: {
      findFirst: jest.fn().mockResolvedValue({
        start_date: new Date('2026-01-01T00:00:00Z'),
        end_date: new Date('2026-12-31T00:00:00Z'),
      }),
      findUnique: jest.fn().mockResolvedValue({
        year_id: 3,
        start_date: new Date('2026-01-01T00:00:00Z'),
        end_date: new Date('2026-12-31T00:00:00Z'),
      }),
    },
    club_role_assignments: {
      findMany: jest.fn().mockResolvedValue([]),
      count: jest.fn().mockResolvedValue(0),
    },
    users_honors: { findMany: jest.fn().mockResolvedValue([]) },
    activities: { count: jest.fn().mockResolvedValue(0) },
    club_enrollments: { findMany: jest.fn().mockResolvedValue([]) },
    monthly_reports: { findMany: jest.fn().mockResolvedValue([]) },
    camporee_clubs: { findMany: jest.fn().mockResolvedValue([]) },
  };

  const aggregation = new FinanceAggregationService(prisma as any);
  const periodService = {
    getClosedPeriodKeys: jest.fn().mockResolvedValue(new Set()),
  };

  const summaryService = new FinancesService(
    prisma as any,
    periodService as any,
    aggregation,
    {} as any,
    {} as any,
    {} as any,
  );
  const monthly = new MonthlyReportsService(
    prisma as any,
    {} as any,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    aggregation,
  );
  const quarterly = new QuarterlyReportsService(
    prisma as any,
    {} as any,
    aggregation,
  );
  const annual = new AnnualReportsService(
    prisma as any,
    {} as any,
    aggregation,
  );

  it('one month: summary and monthly report show the same income, expenses, net and balance', async () => {
    const summary = await summaryService.getSummary(1, 2026, 4, 10);
    const report = await (monthly as any).getFinancesData(10, 4, 2026);

    expect(summary.total_income).toBe(500);
    expect(summary.total_expense).toBe(120);
    expect(summary.net).toBe(380);
    expect(summary.balance).toBe(1380); // 1000 (2025) + 500 - 120
    expect(summary.movement_count).toBe(2);

    expect(report.income).toBe(summary.total_income);
    expect(report.expenses).toBe(summary.total_expense);
    expect(report.balance).toBe(summary.net);
    expect(report.total_balance).toBe(summary.balance);
    expect(report.transactions).toBe(summary.movement_count);
  });

  it('a quarter: the quarterly report equals the sum of its three months', async () => {
    const q = (await quarterly.computeData(1, 2026, 2)).finances;
    const months = await Promise.all(
      [4, 5, 6].map((m) => summaryService.getSummary(1, 2026, m, 10)),
    );

    expect(q.income).toBe(months.reduce((s, m) => s + m.total_income, 0));
    expect(q.expenses).toBe(months.reduce((s, m) => s + m.total_expense, 0));
    expect(q.balance).toBe(q.income - q.expenses);
    expect(q.transactions).toBe(
      months.reduce((s, m) => s + m.movement_count, 0),
    );
    // Cash on hand at the end of the quarter = balance of its last month.
    expect(q.total_balance).toBe(months[2].balance);
    expect(q.total_balance).toBe(1530);
  });

  it('a year: the annual report equals the year summary and keeps the all-time balance', async () => {
    const a = (await annual.computeData(1, 3)).finances;
    const year = await summaryService.getSummary(1, 2026, undefined, 10);

    expect(a.income).toBe(year.total_income);
    expect(a.expenses).toBe(year.total_expense);
    expect(a.balance).toBe(year.net);
    expect(a.total_balance).toBe(year.balance);
    expect(a.income).toBe(1699);
    expect(a.total_balance).toBe(1000 + 1699 - 170);
  });

  it('inactive movements and other clubs never leak into any total', async () => {
    const all = await summaryService.getSummary(1, undefined, undefined, 10);

    // 1000 + 500 + 200 + 999 income, 170 expenses; 7777 (inactive) and 5555 (other section) excluded.
    expect(all.total_income).toBe(2699);
    expect(all.total_expense).toBe(170);
    expect(all.balance).toBe(2529);
  });
});
