import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { ErrorCode } from '../errors/error-codes';
import {
  assertDateInRange,
  checkDateInRange,
  IsDateInRange,
  MIN_CERTIFICATE_DATE,
  todayUtc,
} from './honor-date-range';

const NOW = new Date('2026-10-12T15:00:00.000Z');

describe('honor date range (D6)', () => {
  it('fixes the minimum date at 1960-01-01', () => {
    expect(MIN_CERTIFICATE_DATE).toBe('1960-01-01');
  });

  it.each([
    ['1959-12-31', 'TOO_OLD'],
    ['1925-05-12', 'TOO_OLD'],
    ['1960-01-01', null],
    ['2026-10-12', null],
    ['2026-10-13', 'IN_FUTURE'],
    ['2999-01-01', 'IN_FUTURE'],
    ['2026-02-30', 'INVALID'],
    ['not-a-date', 'INVALID'],
    ['2026-1-5', 'INVALID'],
  ])('checkDateInRange(%s) = %s', (value, expected) => {
    expect(checkDateInRange(value, NOW)).toBe(expected);
  });

  it('uses the UTC civil date of "now" as the upper bound', () => {
    expect(todayUtc(new Date('2026-10-12T23:59:59.999Z'))).toBe('2026-10-12');
    expect(checkDateInRange('2026-10-12', NOW)).toBeNull();
  });

  it('assertDateInRange throws the code that matches the issue', () => {
    const codes = {
      tooOld: ErrorCode.HONOR_DATE_TOO_OLD,
      inFuture: ErrorCode.HONOR_DATE_IN_FUTURE,
    };
    expect(() => assertDateInRange('1959-12-31', codes, NOW)).toThrow(
      expect.objectContaining({ code: ErrorCode.HONOR_DATE_TOO_OLD }),
    );
    expect(() => assertDateInRange('2026-10-13', codes, NOW)).toThrow(
      expect.objectContaining({ code: ErrorCode.HONOR_DATE_IN_FUTURE }),
    );
    expect(() => assertDateInRange('1960-01-01', codes, NOW)).not.toThrow();
    expect(() => assertDateInRange('2026-10-12', codes, NOW)).not.toThrow();
    expect(() => assertDateInRange('garbage', codes, NOW)).toThrow();
  });

  describe('@IsDateInRange()', () => {
    class Probe {
      @IsDateInRange({ tooOld: 'TOO_OLD_CODE', inFuture: 'FUTURE_CODE' })
      date!: unknown;
    }

    const messages = async (date: unknown) => {
      const errors = await validate(plainToInstance(Probe, { date }));
      return errors.flatMap((error) => Object.values(error.constraints ?? {}));
    };

    const tomorrow = () => {
      const next = new Date();
      next.setUTCDate(next.getUTCDate() + 1);
      return todayUtc(next);
    };

    it('rejects 1959-12-31 with the too-old code', async () => {
      await expect(messages('1959-12-31')).resolves.toEqual(['TOO_OLD_CODE']);
    });

    it('accepts 1960-01-01 and today', async () => {
      await expect(messages('1960-01-01')).resolves.toEqual([]);
      await expect(messages(todayUtc())).resolves.toEqual([]);
    });

    it('rejects tomorrow with the future code', async () => {
      await expect(messages(tomorrow())).resolves.toEqual(['FUTURE_CODE']);
    });

    it('rejects malformed values and non strings', async () => {
      await expect(messages('2026-02-30')).resolves.toHaveLength(1);
      await expect(messages(20260101)).resolves.toHaveLength(1);
    });
  });
});
