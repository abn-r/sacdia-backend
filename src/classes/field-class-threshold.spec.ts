import {
  canEditFieldClassThreshold,
  june30InsideYear,
  sectionMeetsThreshold,
} from './field-class-threshold';

describe('field class threshold', () => {
  const year = { yearStart: '2026-01-01', yearEnd: '2026-12-31' };

  it('lets the field edit through 30 June 23:59 local and only super-admin after', () => {
    expect(june30InsideYear('2025-09-01', '2026-08-31')).toBe('2026-06-30');
    expect(
      canEditFieldClassThreshold({
        roles: ['director-lf'],
        now: new Date('2026-07-01T05:59:00.000Z'),
        timeZone: 'America/Mexico_City',
        ...year,
      }),
    ).toBe(true);
    expect(
      canEditFieldClassThreshold({
        roles: ['assistant-lf'],
        now: new Date('2026-07-01T06:00:00.000Z'),
        timeZone: 'America/Mexico_City',
        ...year,
      }),
    ).toBe(false);
    expect(
      canEditFieldClassThreshold({
        roles: ['super-admin'],
        now: new Date('2026-07-01T06:00:00.000Z'),
        timeZone: 'America/Mexico_City',
        ...year,
      }),
    ).toBe(true);
    expect(
      canEditFieldClassThreshold({
        roles: ['admin'],
        now: new Date('2026-06-01T18:00:00.000Z'),
        timeZone: 'America/Mexico_City',
        ...year,
      }),
    ).toBe(false);
  });

  it('counts VALIDATED below the threshold, ignores REJECTED, and applies the configured percent', () => {
    expect(
      sectionMeetsThreshold({ status: 'VALIDATED', score: 10, threshold: 90 }),
    ).toBe(true);
    expect(
      sectionMeetsThreshold({ status: 'REJECTED', score: 100, threshold: 80 }),
    ).toBe(false);
    expect(
      sectionMeetsThreshold({ status: 'PENDING', score: 85, threshold: 90 }),
    ).toBe(false);
    expect(
      sectionMeetsThreshold({ status: 'PENDING', score: 80, threshold: 80 }),
    ).toBe(true);
    expect(
      sectionMeetsThreshold({ status: 'PENDING', score: 79, threshold: 80 }),
    ).toBe(false);
  });
});
