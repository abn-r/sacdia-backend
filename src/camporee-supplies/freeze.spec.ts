import {
  canClubEditSupplyDate,
  lineTotalCentavos,
  parseCutoffMinutes,
} from './freeze';

describe('parseCutoffMinutes', () => {
  it('parses 21:00 as 1260 minutes', () => {
    expect(parseCutoffMinutes('21:00')).toBe(21 * 60);
  });

  it('rejects invalid cutoff', () => {
    expect(() => parseCutoffMinutes('9pm')).toThrow(
      /CAMPOREE_SUPPLIES_CUTOFF_INVALID/,
    );
  });
});

describe('canClubEditSupplyDate', () => {
  const timeZone = 'America/Mexico_City';
  const cutoffHm = '21:00';

  it('allows any date while the plan is DRAFT', () => {
    expect(
      canClubEditSupplyDate({
        planStatus: 'DRAFT',
        supplyDate: '2026-08-20',
        now: new Date('2026-08-26T18:00:00-06:00'),
        timeZone,
        cutoffHm,
      }),
    ).toBe(true);
  });

  it('forbids today and past once SUBMITTED', () => {
    const now = new Date('2026-08-26T10:00:00-06:00');
    expect(
      canClubEditSupplyDate({
        planStatus: 'SUBMITTED',
        supplyDate: '2026-08-26',
        now,
        timeZone,
        cutoffHm,
      }),
    ).toBe(false);
    expect(
      canClubEditSupplyDate({
        planStatus: 'SUBMITTED',
        supplyDate: '2026-08-25',
        now,
        timeZone,
        cutoffHm,
      }),
    ).toBe(false);
  });

  it('allows tomorrow before cutoff and locks it at 21:00', () => {
    expect(
      canClubEditSupplyDate({
        planStatus: 'SUBMITTED',
        supplyDate: '2026-08-27',
        now: new Date('2026-08-26T20:59:00-06:00'),
        timeZone,
        cutoffHm,
      }),
    ).toBe(true);
    expect(
      canClubEditSupplyDate({
        planStatus: 'SUBMITTED',
        supplyDate: '2026-08-27',
        now: new Date('2026-08-26T21:00:00-06:00'),
        timeZone,
        cutoffHm,
      }),
    ).toBe(false);
  });

  it('allows day-after-tomorrow even after cutoff', () => {
    expect(
      canClubEditSupplyDate({
        planStatus: 'SUBMITTED',
        supplyDate: '2026-08-28',
        now: new Date('2026-08-26T22:00:00-06:00'),
        timeZone,
        cutoffHm,
      }),
    ).toBe(true);
  });
});

describe('lineTotalCentavos', () => {
  it('multiplies decimal kg by unit cost and half-up rounds', () => {
    expect(lineTotalCentavos('1.5', 1000)).toBe(1500);
    expect(lineTotalCentavos('0.333', 100)).toBe(33);
  });
});
