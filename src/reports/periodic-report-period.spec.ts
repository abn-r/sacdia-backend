import {
  buildReportPeriod,
  ecclesiasticalYearPeriod,
  isPastGrace,
  quarterOf,
  quarterPeriod,
  reportsToday,
  startOfDayInTimeZone,
} from './periodic-report-period';

const utc = (iso: string) => new Date(`${iso}T00:00:00Z`);

describe('periodic report periods', () => {
  it('builds a half-open quarter: the day after the last day is the exclusive end', () => {
    const q2 = quarterPeriod(2026, 2);

    expect(q2.startDate).toEqual(utc('2026-04-01'));
    expect(q2.endDate).toEqual(utc('2026-06-30'));
    expect(q2.endExclusiveDate).toEqual(utc('2026-07-01'));
    expect(q2.months).toEqual([
      { year: 2026, month: 4 },
      { year: 2026, month: 5 },
      { year: 2026, month: 6 },
    ]);
  });

  it('puts the Mexico City midnights on the timestamp bounds (UTC-6, no DST)', () => {
    const q2 = quarterPeriod(2026, 2);
    expect(q2.startInstant).toEqual(new Date('2026-04-01T06:00:00Z'));
    // A timestamp at 23:30 local on June 30 (05:30Z on July 1) is inside.
    expect(q2.endExclusiveInstant).toEqual(new Date('2026-07-01T06:00:00Z'));
    expect(new Date('2026-07-01T05:30:00Z') < q2.endExclusiveInstant).toBe(
      true,
    );
  });

  it('computes the start of a civil day in a zone with DST', () => {
    // New York is UTC-4 in July and UTC-5 in January.
    expect(startOfDayInTimeZone(2026, 7, 1, 'America/New_York')).toEqual(
      new Date('2026-07-01T04:00:00Z'),
    );
    expect(startOfDayInTimeZone(2026, 1, 1, 'America/New_York')).toEqual(
      new Date('2026-01-01T05:00:00Z'),
    );
  });

  it('covers exactly the months of a non-calendar ecclesiastical year', () => {
    const year = ecclesiasticalYearPeriod({
      start_date: utc('2025-10-01'),
      end_date: utc('2026-09-30'),
    });

    expect(year.months).toHaveLength(12);
    expect(year.months[0]).toEqual({ year: 2025, month: 10 });
    expect(year.months[11]).toEqual({ year: 2026, month: 9 });
    expect(year.endExclusiveDate).toEqual(utc('2026-10-01'));
  });

  it('handles a single-month period', () => {
    expect(
      buildReportPeriod(utc('2026-02-01'), utc('2026-02-28')).months,
    ).toEqual([{ year: 2026, month: 2 }]);
  });

  it('reportsToday uses the Mexico City civil day, not the UTC day', () => {
    // 03:00Z on Jan 2 is still Jan 1 evening in Mexico City.
    expect(reportsToday(new Date('2026-01-02T03:00:00Z'))).toEqual(
      utc('2026-01-01'),
    );
  });

  it('isPastGrace: the period must have ended MORE than graceDays ago', () => {
    const end = utc('2026-06-30');
    expect(isPastGrace(end, utc('2026-07-15'), 15)).toBe(false);
    expect(isPastGrace(end, utc('2026-07-16'), 15)).toBe(true);
    expect(isPastGrace(end, utc('2026-07-01'), 0)).toBe(true);
  });

  it('quarterOf reads the calendar quarter', () => {
    expect(quarterOf(utc('2026-04-01'))).toEqual({ year: 2026, quarter: 2 });
    expect(quarterOf(utc('2026-12-31'))).toEqual({ year: 2026, quarter: 4 });
  });
});
