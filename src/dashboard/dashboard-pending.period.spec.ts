import {
  calendarDateInZone,
  resolveMonthlyReportDue,
} from './dashboard-pending.period';

describe('resolveMonthlyReportDue', () => {
  const at = (day: number, month = 11, year = 2026) =>
    resolveMonthlyReportDue({ year, month, day }, 5);

  it.each([
    [3, 2],
    [5, 0],
    [6, -1],
    [20, -15],
    [26, -21],
  ])(
    'day %i: previous month (October), due 2026-11-05, days_left %i',
    (day, daysLeft) => {
      expect(at(day)).toEqual({
        period_month: 10,
        period_year: 2026,
        due_date: '2026-11-05',
        days_left: daysLeft,
      });
    },
  );

  it('day 27: current month, due next month day 5', () => {
    expect(at(27)).toEqual({
      period_month: 11,
      period_year: 2026,
      due_date: '2026-12-05',
      days_left: 8,
    });
  });

  it('day 31: current month, due next month', () => {
    expect(at(31, 10)).toEqual({
      period_month: 10,
      period_year: 2026,
      due_date: '2026-11-05',
      days_left: 5,
    });
  });

  it('January rolls back to December of the previous year', () => {
    expect(at(3, 1, 2027)).toEqual({
      period_month: 12,
      period_year: 2026,
      due_date: '2027-01-05',
      days_left: 2,
    });
  });

  it('December day 27+ rolls the due date into January', () => {
    expect(at(28, 12)).toMatchObject({
      period_month: 12,
      period_year: 2026,
      due_date: '2027-01-05',
      days_left: 8,
    });
  });

  it('honors a configured due day', () => {
    expect(
      resolveMonthlyReportDue({ year: 2026, month: 11, day: 4 }, 10),
    ).toMatchObject({ due_date: '2026-11-10', days_left: 6 });
  });
});

describe('calendarDateInZone', () => {
  it('uses America/Mexico_City, not UTC', () => {
    // 03:00 UTC on Nov 5 is still Nov 4 in Mexico City (UTC-6).
    expect(calendarDateInZone(new Date('2026-11-05T03:00:00Z'))).toEqual({
      year: 2026,
      month: 11,
      day: 4,
    });
  });
});
