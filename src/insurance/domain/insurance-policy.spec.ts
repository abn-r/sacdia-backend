import {
  assertSameClubTransfer,
  calculateInsuranceTimelinessScore,
  classifyInsurancePurchase,
  resolveInsuranceValidity,
} from './insurance-policy';

describe('insurance domain policies', () => {
  it('classifies a receipt on the deadline as ORDINARY using date-only comparison', () => {
    expect(
      classifyInsurancePurchase(
        new Date('2026-03-31T23:59:59.999Z'),
        new Date('2026-03-31T00:00:00.000Z'),
      ),
    ).toBe('ORDINARY');
  });

  it('classifies a receipt after the deadline as EXTRAORDINARY', () => {
    expect(
      classifyInsurancePurchase(
        new Date('2026-04-01T00:00:00.000Z'),
        new Date('2026-03-31T23:59:59.999Z'),
      ),
    ).toBe('EXTRAORDINARY');
  });

  it('scores ordinary quantity over the total confirmed quantity', () => {
    expect(
      calculateInsuranceTimelinessScore({
        ordinaryQuantity: 20,
        extraordinaryQuantity: 10,
      }),
    ).toBe(66.67);
  });

  it('returns zero when there is no confirmed quantity', () => {
    expect(
      calculateInsuranceTimelinessScore({
        ordinaryQuantity: 0,
        extraordinaryQuantity: 0,
      }),
    ).toBe(0);
  });

  it('rejects transfers between sections from different main clubs', () => {
    expect(() =>
      assertSameClubTransfer({ main_club_id: 10 }, { main_club_id: 20 }),
    ).toThrow(
      'Insurance slots can only be transferred within the same main club',
    );
  });

  it('uses the exact event dates for event coverage', () => {
    const event = {
      startsAt: new Date('2026-07-10T00:00:00.000Z'),
      endsAt: new Date('2026-07-14T23:59:59.999Z'),
    };

    expect(
      resolveInsuranceValidity({ validityMode: 'EVENT_DATES' }, event),
    ).toEqual({ startsAt: event.startsAt, endsAt: event.endsAt });
  });

  it('adds fixed validity months without mutating input dates', () => {
    const startsAt = new Date('2026-01-31T12:00:00.000Z');
    const config = {
      validityMode: 'FIXED_MONTHS' as const,
      startsAt,
      durationMonths: 12,
    };

    expect(resolveInsuranceValidity(config)).toEqual({
      startsAt: new Date('2026-01-31T12:00:00.000Z'),
      endsAt: new Date('2027-01-31T12:00:00.000Z'),
    });
    expect(startsAt).toEqual(new Date('2026-01-31T12:00:00.000Z'));
  });

  it('clamps fixed validity at the last valid day of the target month', () => {
    expect(
      resolveInsuranceValidity({
        validityMode: 'FIXED_MONTHS',
        startsAt: new Date('2026-01-31T12:34:56.789Z'),
        durationMonths: 1,
      }),
    ).toEqual({
      startsAt: new Date('2026-01-31T12:34:56.789Z'),
      endsAt: new Date('2026-02-28T12:34:56.789Z'),
    });
  });
});
