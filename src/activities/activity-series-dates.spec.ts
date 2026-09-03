import {
  ACTIVITY_SERIES_MAX_OCCURRENCES,
  addCalendarDays,
  calendarDateInTimeZone,
  durationDays,
  expandActivitySeriesDates,
  isoWeekday,
} from './activity-series-dates';

describe('activity-series-dates', () => {
  it('maps Sunday to ISO weekday 7', () => {
    expect(isoWeekday('2026-03-08')).toBe(7);
    expect(isoWeekday('2026-03-09')).toBe(1);
  });

  it('expands weekly Sundays inclusive of until', () => {
    const dates = expandActivitySeriesDates({
      start: '2026-03-08',
      until: '2026-03-29',
      rule: { kind: 'weekly', weekdays: [7] },
    });
    expect(dates).toEqual([
      '2026-03-08',
      '2026-03-15',
      '2026-03-22',
      '2026-03-29',
    ]);
  });

  it('starts weekly on the next matching weekday', () => {
    const dates = expandActivitySeriesDates({
      start: '2026-03-11',
      until: '2026-03-22',
      rule: { kind: 'weekly', weekdays: [7] },
    });
    expect(dates).toEqual(['2026-03-15', '2026-03-22']);
  });

  it('expands every 3 days', () => {
    const dates = expandActivitySeriesDates({
      start: '2026-03-08',
      until: '2026-03-17',
      rule: { kind: 'interval', intervalDays: 3 },
    });
    expect(dates).toEqual([
      '2026-03-08',
      '2026-03-11',
      '2026-03-14',
      '2026-03-17',
    ]);
  });

  it('returns empty when until is before start', () => {
    expect(
      expandActivitySeriesDates({
        start: '2026-03-10',
        until: '2026-03-09',
        rule: { kind: 'interval', intervalDays: 1 },
      }),
    ).toEqual([]);
  });

  it('caps expansion just over the max', () => {
    const dates = expandActivitySeriesDates({
      start: '2026-01-01',
      until: '2027-12-31',
      rule: { kind: 'interval', intervalDays: 1 },
    });
    expect(dates.length).toBe(ACTIVITY_SERIES_MAX_OCCURRENCES + 1);
  });

  it('computes duration and calendar arithmetic', () => {
    expect(durationDays('2026-03-08', '2026-03-10')).toBe(2);
    expect(durationDays('2026-03-08', '2026-03-08')).toBe(0);
    expect(addCalendarDays('2026-03-08', 7)).toBe('2026-03-15');
  });

  it('formats today in Mexico City', () => {
    const date = calendarDateInTimeZone(
      new Date('2026-03-08T06:30:00.000Z'),
      'America/Mexico_City',
    );
    expect(date).toBe('2026-03-08');
  });
});
