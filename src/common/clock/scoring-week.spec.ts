import {
  getScoringWeekPeriod,
  getScoringWeekRangeForMonth,
} from './scoring-week';

describe('scoring week (Sunday–Saturday, America/Mexico_City)', () => {
  it('keeps Monday 2026-06-29 in week 27 of 2026', () => {
    const period = getScoringWeekPeriod(new Date('2026-06-29T12:00:00.000Z'));

    expect(period).toEqual({
      week: 27,
      year: 2026,
      startDate: '2026-06-28',
      endDate: '2026-07-04',
    });
  });

  it('stays on the same week at Saturday 23:59 Mexico', () => {
    const period = getScoringWeekPeriod(new Date('2026-07-05T05:59:00.000Z'));

    expect(period.week).toBe(27);
    expect(period.year).toBe(2026);
    expect(period.endDate).toBe('2026-07-04');
  });

  it('opens a new week at Sunday 00:00 Mexico', () => {
    const period = getScoringWeekPeriod(new Date('2026-07-05T06:00:00.000Z'));

    expect(period).toEqual({
      week: 28,
      year: 2026,
      startDate: '2026-07-05',
      endDate: '2026-07-11',
    });
  });

  it('attributes a week that spans years to the Saturday year', () => {
    const period = getScoringWeekPeriod(new Date('2026-01-01T18:00:00.000Z'));

    expect(period.startDate).toBe('2025-12-28');
    expect(period.endDate).toBe('2026-01-03');
    expect(period.year).toBe(2026);
    expect(period.week).toBe(1);
  });

  it('lists Saturday weeks that fall in June 2026', () => {
    expect(getScoringWeekRangeForMonth(2026, 6)).toEqual({
      startWeek: 23,
      endWeek: 26,
    });
  });
});
