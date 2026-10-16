import {
  ageAt,
  ageToday,
  calendarDateIn,
  DEFAULT_AGE_TIMEZONE,
  isBirthdayInFuture,
  parseCalendarDate,
} from './age.util';

const day = (iso: string): Date => new Date(`${iso}T00:00:00.000Z`);

describe('age.util', () => {
  describe('ageAt', () => {
    it('counts whole years once the birthday has passed', () => {
      expect(ageAt(day('2000-01-01'), day('2026-03-20'))).toBe(26);
    });

    it('subtracts one year when the birthday has not been reached yet', () => {
      expect(ageAt(day('2000-12-31'), day('2026-03-20'))).toBe(25);
    });

    it('turns the year exactly on the birthday', () => {
      expect(ageAt(day('2010-10-17'), day('2026-10-16'))).toBe(15);
      expect(ageAt(day('2010-10-17'), day('2026-10-17'))).toBe(16);
    });

    it('handles Feb 29 birthdays: not 18 on Feb 28, 18 on Mar 1', () => {
      expect(ageAt(day('2008-02-29'), day('2026-02-28'))).toBe(17);
      expect(ageAt(day('2008-02-29'), day('2026-03-01'))).toBe(18);
    });

    it('is independent of the server time zone (UTC getters only)', () => {
      const original = process.env.TZ;
      try {
        process.env.TZ = 'Pacific/Auckland';
        expect(ageAt(day('2008-06-15'), day('2026-06-15'))).toBe(18);
        process.env.TZ = 'Pacific/Honolulu';
        expect(ageAt(day('2008-06-15'), day('2026-06-14'))).toBe(17);
      } finally {
        if (original === undefined) delete process.env.TZ;
        else process.env.TZ = original;
      }
    });

    it('returns a negative age for a future birthday', () => {
      expect(ageAt(day('2030-01-01'), day('2026-10-16'))).toBeLessThan(0);
    });
  });

  describe('calendarDateIn', () => {
    it('reads the calendar date of the zone, not of UTC', () => {
      // 2026-10-17T03:00Z is still Oct 16 21:00 in Mexico City (UTC-6).
      const at = new Date('2026-10-17T03:00:00.000Z');
      expect(calendarDateIn('America/Mexico_City', at).toISOString()).toBe(
        '2026-10-16T00:00:00.000Z',
      );
      expect(calendarDateIn('UTC', at).toISOString()).toBe(
        '2026-10-17T00:00:00.000Z',
      );
    });

    it('falls back to the default zone for an unknown IANA name', () => {
      const at = new Date('2026-10-17T03:00:00.000Z');
      expect(calendarDateIn('Mars/Olympus_Mons', at).toISOString()).toBe(
        calendarDateIn(DEFAULT_AGE_TIMEZONE, at).toISOString(),
      );
    });
  });

  describe('ageToday', () => {
    const now = new Date('2026-10-17T03:00:00.000Z');

    it('MX vs UTC day boundary: the same instant gives different ages', () => {
      const birthday = day('2010-10-17');
      expect(ageToday(birthday, 'America/Mexico_City', now)).toBe(15);
      expect(ageToday(birthday, 'UTC', now)).toBe(16);
    });

    it('computes the 13th birthday cutoff in the reference zone', () => {
      expect(ageToday(day('2013-10-17'), 'America/Mexico_City', now)).toBe(12);
      expect(ageToday(day('2013-10-16'), 'America/Mexico_City', now)).toBe(13);
    });
  });

  describe('isBirthdayInFuture', () => {
    const now = new Date('2026-10-17T03:00:00.000Z');

    it('flags a birthday after today in the zone', () => {
      expect(
        isBirthdayInFuture(day('2026-10-17'), 'America/Mexico_City', now),
      ).toBe(true);
      expect(isBirthdayInFuture(day('2030-01-01'), 'UTC', now)).toBe(true);
    });

    it('accepts today and past dates', () => {
      expect(
        isBirthdayInFuture(day('2026-10-16'), 'America/Mexico_City', now),
      ).toBe(false);
      expect(isBirthdayInFuture(day('2026-10-17'), 'UTC', now)).toBe(false);
      expect(isBirthdayInFuture(day('2017-04-02'), 'UTC', now)).toBe(false);
    });
  });

  describe('parseCalendarDate', () => {
    it('parses a strict YYYY-MM-DD into UTC midnight', () => {
      expect(parseCalendarDate('2012-02-29')).toEqual(day('2012-02-29'));
    });

    it.each([
      '2017-02-31',
      '2027-02-29',
      '2017-4-2',
      '2017-04-02T00:00:00Z',
      '',
    ])('returns null for %j', (value) => {
      expect(parseCalendarDate(value)).toBeNull();
    });
  });
});
