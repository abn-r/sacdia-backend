import * as vm from 'node:vm';
import {
  ageAt,
  ageToday,
  calendarDateIn,
  DEFAULT_AGE_TIMEZONE,
  isBirthdayInFuture,
  isInMajorityNoticeWindow,
  majorityDateOf,
  parseCalendarDate,
  toDateValue,
} from './age.util';

const day = (iso: string): Date => new Date(`${iso}T00:00:00.000Z`);

describe('age.util', () => {
  describe('ageAt with values that went through a JSON cache', () => {
    it('accepts an ISO string birthday (a Prisma Date after a Redis round-trip)', () => {
      expect(ageAt('2010-10-17T00:00:00.000Z', day('2026-10-17'))).toBe(16);
      expect(ageAt('2010-10-17', day('2026-10-16'))).toBe(15);
    });

    it('ageToday accepts an ISO string birthday', () => {
      const now = new Date('2026-10-20T18:00:00.000Z');
      expect(
        ageToday('2008-10-20T00:00:00.000Z', DEFAULT_AGE_TIMEZONE, now),
      ).toBe(18);
    });

    it('fails closed on an unreadable birthday: age 0, the youngest (every minor gate applies)', () => {
      expect(ageAt('not-a-date', day('2026-10-17'))).toBe(0);
      expect(ageAt(new Date('invalid'), day('2026-10-17'))).toBe(0);
      expect(
        ageToday(
          undefined as unknown as Date,
          DEFAULT_AGE_TIMEZONE,
          new Date('2026-10-20T18:00:00.000Z'),
        ),
      ).toBe(0);
    });

    it('accepts a Date from another realm (structuredClone / vm), not only this realm instanceof', () => {
      const foreign = vm.runInNewContext(
        "new Date('2010-10-17T00:00:00.000Z')",
      ) as Date;
      expect(foreign instanceof Date).toBe(false);
      expect(toDateValue(foreign)?.getTime()).toBe(day('2010-10-17').getTime());
      expect(ageAt(foreign, day('2026-10-17'))).toBe(16);
    });

    it('toDateValue revives Date, ISO strings and rejects garbage', () => {
      const d = day('2010-01-02');
      expect(toDateValue(d)).toBe(d);
      expect(toDateValue('2010-01-02T00:00:00.000Z')?.getTime()).toBe(
        d.getTime(),
      );
      expect(toDateValue('nope')).toBeNull();
      expect(toDateValue(null)).toBeNull();
      expect(toDateValue(undefined)).toBeNull();
      expect(toDateValue(12 as unknown as string)).toBeNull();
      expect(toDateValue(new Date('invalid'))).toBeNull();
    });
  });

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

describe('majority release age math', () => {
  const iso = (d: Date | null) => d?.toISOString().slice(0, 10);

  it('Feb-29 birth reaches 18 on Mar-1 of a non-leap year (matches ageAt)', () => {
    const born = day('2008-02-29');
    const majority = majorityDateOf(born, 18);
    expect(iso(majority)).toBe('2026-03-01');
    expect(ageAt(born, day('2026-02-28'))).toBe(17);
    expect(ageAt(born, day('2026-03-01'))).toBe(18);
  });

  it('Feb-29 birth with a leap target year stays on Feb-29', () => {
    expect(iso(majorityDateOf(day('2004-02-29'), 20))).toBe('2024-02-29');
    expect(iso(majorityDateOf(day('2004-02-29'), 18))).toBe('2022-03-01');
  });

  it('supports an age of majority of 21', () => {
    expect(iso(majorityDateOf(day('2005-06-15'), 21))).toBe('2026-06-15');
  });

  it('agrees with ageAt for the first day it reaches the age', () => {
    for (const b of ['2008-01-31', '2008-02-29', '2007-12-31', '2010-03-01']) {
      const majority = majorityDateOf(day(b), 18) as Date;
      expect(ageAt(day(b), majority)).toBe(18);
      expect(
        ageAt(day(b), new Date(majority.getTime() - 24 * 3600 * 1000)),
      ).toBe(17);
    }
  });

  it('returns null for an unreadable birthday', () => {
    expect(majorityDateOf('nope', 18)).toBeNull();
  });

  describe('isInMajorityNoticeWindow', () => {
    it('Feb-29 birth: window opens 2026-01-30 and closes on majority 2026-03-01', () => {
      const born = day('2008-02-29');
      const at = (s: string) => new Date(`${s}T15:00:00.000Z`);
      const check = (s: string) =>
        isInMajorityNoticeWindow(born, 18, 'UTC', 30, at(s));
      expect(check('2026-01-29')).toBe(false);
      expect(check('2026-01-30')).toBe(true);
      expect(check('2026-02-28')).toBe(true);
      expect(check('2026-03-01')).toBe(false);
    });

    it('majority 2027-03-31: 2027-03-01 is inside, 2027-02-28 is not', () => {
      const born = day('2009-03-31');
      const at = (s: string) => new Date(`${s}T15:00:00.000Z`);
      expect(
        isInMajorityNoticeWindow(born, 18, 'UTC', 30, at('2027-03-01')),
      ).toBe(true);
      expect(
        isInMajorityNoticeWindow(born, 18, 'UTC', 30, at('2027-02-28')),
      ).toBe(false);
    });

    it('uses the person calendar: Mexico_City vs UTC around midnight', () => {
      const born = day('2008-03-31');
      // 2026-03-01T03:00Z is still 2026-02-28 in Mexico_City (UTC-6).
      const now = new Date('2026-03-01T03:00:00.000Z');
      expect(isInMajorityNoticeWindow(born, 18, 'UTC', 30, now)).toBe(true);
      expect(
        isInMajorityNoticeWindow(born, 18, 'America/Mexico_City', 30, now),
      ).toBe(false);
    });

    it('Pacific/Auckland is ahead of UTC', () => {
      const born = day('2008-03-31');
      // 2026-02-28T12:00Z is already 2026-03-01 in Auckland (UTC+13).
      const now = new Date('2026-02-28T12:00:00.000Z');
      expect(isInMajorityNoticeWindow(born, 18, 'UTC', 30, now)).toBe(false);
      expect(
        isInMajorityNoticeWindow(born, 18, 'Pacific/Auckland', 30, now),
      ).toBe(true);
    });

    it('is false once of age and for an unreadable birthday', () => {
      expect(
        isInMajorityNoticeWindow(
          day('2008-02-01'),
          18,
          'UTC',
          30,
          new Date('2026-03-15T00:00:00.000Z'),
        ),
      ).toBe(false);
      expect(isInMajorityNoticeWindow('nope', 18, 'UTC', 30)).toBe(false);
    });
  });
});
