import { calculateAge } from './eligibility-rule-handlers';

describe('eligibility-rule-handlers calculateAge', () => {
  const originalTz = process.env.TZ;

  afterEach(() => {
    if (originalTz === undefined) delete process.env.TZ;
    else process.env.TZ = originalTz;
  });

  it('counts whole years on the UTC calendar of a @db.Date birthday', () => {
    expect(
      calculateAge(
        new Date('2008-06-15T00:00:00.000Z'),
        new Date('2026-06-15T00:00:00.000Z'),
      ),
    ).toBe(18);
    expect(
      calculateAge(
        new Date('2008-06-15T00:00:00.000Z'),
        new Date('2026-06-14T23:59:59.000Z'),
      ),
    ).toBe(17);
  });

  it('does not change with the server time zone', () => {
    const birthday = new Date('2008-06-15T00:00:00.000Z');
    const asOf = new Date('2026-06-15T02:00:00.000Z');

    process.env.TZ = 'America/Mexico_City';
    const inMexico = calculateAge(birthday, asOf);
    process.env.TZ = 'Pacific/Auckland';
    const inAuckland = calculateAge(birthday, asOf);

    expect(inMexico).toBe(18);
    expect(inAuckland).toBe(18);
  });
});
