import {
  canEditInvestitureWindow,
  defaultInvestitureWindow,
  investitureWindowAllowsOperation,
} from './field-investiture-window';

describe('defaultInvestitureWindow', () => {
  it('uses 1 October through 20 December when both dates sit inside the year', () => {
    expect(defaultInvestitureWindow('2026-01-01', '2026-12-31')).toEqual({
      start_date: '2026-10-01',
      end_date: '2026-12-20',
    });
  });

  it('uses the October that falls inside a year crossing 1 January', () => {
    expect(defaultInvestitureWindow('2025-09-01', '2026-08-31')).toEqual({
      start_date: '2025-10-01',
      end_date: '2025-12-20',
    });
  });

  it('clips the start when 1 October is before the year', () => {
    expect(defaultInvestitureWindow('2026-11-01', '2026-12-31')).toEqual({
      start_date: '2026-11-01',
      end_date: '2026-12-20',
    });
  });

  it('clips the end when 20 December is after the year', () => {
    expect(defaultInvestitureWindow('2026-01-01', '2026-11-15')).toEqual({
      start_date: '2026-10-01',
      end_date: '2026-11-15',
    });
  });

  it('stays closed when October–December does not overlap the year', () => {
    expect(defaultInvestitureWindow('2026-01-01', '2026-06-30')).toBeNull();
  });
});

describe('investitureWindowAllowsOperation', () => {
  const year = {
    yearStart: '2026-01-01',
    yearEnd: '2026-12-31',
    yearActive: true,
    windowStart: '2026-10-01',
    windowEnd: '2026-12-20',
  };

  it('includes the first and last local day for present, add and authorize', () => {
    const actions = ['present', 'add', 'authorize'] as const;
    const openAtStart = new Date('2026-10-01T06:00:00.000Z');
    const stillOpenAtEnd = new Date('2026-12-21T05:59:00.000Z');
    const before = new Date('2026-10-01T05:59:00.000Z');
    const after = new Date('2026-12-21T06:00:00.000Z');

    for (const _action of actions) {
      expect(
        investitureWindowAllowsOperation({
          ...year,
          now: openAtStart,
          timeZone: 'America/Mexico_City',
        }),
      ).toBe(true);
      expect(
        investitureWindowAllowsOperation({
          ...year,
          now: stillOpenAtEnd,
          timeZone: 'America/Mexico_City',
        }),
      ).toBe(true);
      expect(
        investitureWindowAllowsOperation({
          ...year,
          now: before,
          timeZone: 'America/Mexico_City',
        }),
      ).toBe(false);
      expect(
        investitureWindowAllowsOperation({
          ...year,
          now: after,
          timeZone: 'America/Mexico_City',
        }),
      ).toBe(false);
    }
  });

  it('uses the field timezone, including America/New_York', () => {
    expect(
      investitureWindowAllowsOperation({
        ...year,
        now: new Date('2026-10-01T04:00:00.000Z'),
        timeZone: 'America/New_York',
      }),
    ).toBe(true);
    expect(
      investitureWindowAllowsOperation({
        ...year,
        now: new Date('2026-10-01T03:59:00.000Z'),
        timeZone: 'America/New_York',
      }),
    ).toBe(false);
  });

  it('blocks the operation when there is no window', () => {
    expect(
      investitureWindowAllowsOperation({
        ...year,
        yearStart: '2026-01-01',
        yearEnd: '2026-06-30',
        windowStart: null,
        windowEnd: null,
        now: new Date('2026-02-15T18:00:00.000Z'),
        timeZone: 'America/Mexico_City',
      }),
    ).toBe(false);
  });

  it('blocks the operation when the year is inactive or the local day is outside the year', () => {
    expect(
      investitureWindowAllowsOperation({
        ...year,
        yearActive: false,
        now: new Date('2026-11-01T18:00:00.000Z'),
        timeZone: 'America/Mexico_City',
      }),
    ).toBe(false);
    expect(
      investitureWindowAllowsOperation({
        ...year,
        now: new Date('2027-01-01T18:00:00.000Z'),
        timeZone: 'America/Mexico_City',
      }),
    ).toBe(false);
  });
});

describe('canEditInvestitureWindow', () => {
  const openYear = {
    now: new Date('2026-10-15T18:00:00.000Z'),
    timeZone: 'America/Mexico_City',
    yearStart: '2026-01-01',
    yearEnd: '2026-12-31',
    yearActive: true,
  };

  it('allows the field director, admin in scope and super-admin while the year is open', () => {
    expect(
      canEditInvestitureWindow({
        ...openYear,
        roles: ['director-lf'],
        editsOwnField: true,
        editsByAdminScope: false,
      }),
    ).toBe(true);
    expect(
      canEditInvestitureWindow({
        ...openYear,
        roles: ['admin'],
        editsOwnField: false,
        editsByAdminScope: true,
      }),
    ).toBe(true);
    expect(
      canEditInvestitureWindow({
        ...openYear,
        roles: ['super-admin'],
        editsOwnField: false,
        editsByAdminScope: false,
      }),
    ).toBe(true);
  });

  it('denies union, a field director outside the year, and an inactive year', () => {
    expect(
      canEditInvestitureWindow({
        ...openYear,
        roles: ['director-union'],
        editsOwnField: false,
        editsByAdminScope: false,
      }),
    ).toBe(false);
    expect(
      canEditInvestitureWindow({
        ...openYear,
        now: new Date('2027-01-01T18:00:00.000Z'),
        roles: ['super-admin'],
        editsOwnField: false,
        editsByAdminScope: false,
      }),
    ).toBe(false);
    expect(
      canEditInvestitureWindow({
        ...openYear,
        yearActive: false,
        roles: ['director-lf'],
        editsOwnField: true,
        editsByAdminScope: false,
      }),
    ).toBe(false);
  });
});
