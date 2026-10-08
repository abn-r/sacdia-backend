import { investitureRequestYearEnded } from './ecclesiastical-year-local-day';

describe('investitureRequestYearEnded', () => {
  const endDate = '2025-12-31';

  it.each([
    ['America/Tijuana', '2026-01-01T07:30:00.000Z', false],
    ['America/Tijuana', '2026-01-01T08:30:00.000Z', true],
    ['America/Bogota', '2026-01-01T04:30:00.000Z', false],
    ['America/Bogota', '2026-01-01T05:30:00.000Z', true],
  ] as const)(
    'C1RR-2 %s at %s ended=%s while the year stays active',
    (timeZone, instant, ended) => {
      expect(
        investitureRequestYearEnded({
          active: true,
          endDate,
          now: new Date(instant),
          timeZone,
        }),
      ).toBe(ended);
    },
  );

  it('treats an inactive year as ended without reading the timezone', () => {
    expect(
      investitureRequestYearEnded({
        active: false,
        endDate,
        now: new Date('2025-06-01T12:00:00.000Z'),
        timeZone: 'America/Tijuana',
      }),
    ).toBe(true);
  });
});
