import {
  HISTORICAL_PRECISIONS,
  assertValidEffectiveInterval,
  containsEffectiveInstant,
  createCorrectionRevision,
  isHistoricalPrecision,
  parseEffectiveDate,
} from './temporal-interval.policy';
import type { TemporalRevision } from './institutional-history.types';

describe('temporal-interval.policy', () => {
  describe('containsEffectiveInstant — half-open [from, to)', () => {
    it('includes valid_from', () => {
      expect(
        containsEffectiveInstant(
          { validFrom: '2024-01-01', validTo: '2025-01-01' },
          '2024-01-01',
        ),
      ).toBe(true);
    });

    it('excludes valid_to', () => {
      expect(
        containsEffectiveInstant(
          { validFrom: '2024-01-01', validTo: '2025-01-01' },
          '2025-01-01',
        ),
      ).toBe(false);
    });

    it('includes dates strictly inside the interval', () => {
      expect(
        containsEffectiveInstant(
          { validFrom: '2024-01-01', validTo: '2025-01-01' },
          '2024-06-15',
        ),
      ).toBe(true);
    });

    it('treats null valid_to as open-ended', () => {
      expect(
        containsEffectiveInstant(
          { validFrom: '2024-01-01', validTo: null },
          '2099-12-31',
        ),
      ).toBe(true);
    });
  });

  describe('assertValidEffectiveInterval', () => {
    it('rejects valid_to equal to valid_from', () => {
      expect(() =>
        assertValidEffectiveInterval({
          validFrom: '2024-01-01',
          validTo: '2024-01-01',
        }),
      ).toThrow(/valid_to.*valid_from/i);
    });

    it('rejects valid_to before valid_from', () => {
      expect(() =>
        assertValidEffectiveInterval({
          validFrom: '2024-06-01',
          validTo: '2024-01-01',
        }),
      ).toThrow(/valid_to.*valid_from/i);
    });

    it('accepts open-ended intervals', () => {
      expect(() =>
        assertValidEffectiveInterval({
          validFrom: '2024-01-01',
          validTo: null,
        }),
      ).not.toThrow();
    });

    it('accepts intervals where valid_to is strictly after valid_from', () => {
      expect(() =>
        assertValidEffectiveInterval({
          validFrom: '2024-01-01',
          validTo: '2024-01-02',
        }),
      ).not.toThrow();
    });
  });

  describe('HistoricalPrecision', () => {
    it('admits only the closed set of precision values', () => {
      expect(HISTORICAL_PRECISIONS).toEqual([
        'exact',
        'day',
        'month',
        'year',
        'system_backfill',
        'unknown',
      ]);
    });

    it.each([
      'exact',
      'day',
      'month',
      'year',
      'system_backfill',
      'unknown',
    ] as const)('accepts %s', (value) => {
      expect(isHistoricalPrecision(value)).toBe(true);
    });

    it.each(['', 'week', 'hour', 'EXACT', 'system-backfill'])(
      'rejects %s',
      (value) => {
        expect(isHistoricalPrecision(value)).toBe(false);
      },
    );
  });

  describe('createCorrectionRevision', () => {
    it('creates a new revision and does not mutate the previous one', () => {
      const previous: TemporalRevision = {
        revisionId: 'rev-1',
        validFrom: '2020-01-01',
        validTo: null,
        precision: 'system_backfill',
        recordedFrom: '2020-01-01T00:00:00.000Z',
        recordedTo: null,
        supersedesRevisionId: null,
      };

      const snapshot = structuredClone(previous);
      const next = createCorrectionRevision(previous, {
        revisionId: 'rev-2',
        validFrom: '2020-01-01',
        validTo: '2024-01-01',
        precision: 'day',
        recordedFrom: '2026-07-23T12:00:00.000Z',
      });

      expect(previous).toEqual(snapshot);
      expect(next).toEqual({
        revisionId: 'rev-2',
        validFrom: '2020-01-01',
        validTo: '2024-01-01',
        precision: 'day',
        recordedFrom: '2026-07-23T12:00:00.000Z',
        recordedTo: null,
        supersedesRevisionId: 'rev-1',
      });
      expect(next).not.toBe(previous);
    });
  });

  describe('parseEffectiveDate', () => {
    it('accepts YYYY-MM-DD', () => {
      expect(parseEffectiveDate('2024-01-15')).toBe('2024-01-15');
    });

    it('rejects timestamps for commands that require YYYY-MM-DD', () => {
      expect(() => parseEffectiveDate('2024-01-15T00:00:00.000Z')).toThrow(
        /YYYY-MM-DD/,
      );
      expect(() => parseEffectiveDate('2024-01-15 00:00:00')).toThrow(
        /YYYY-MM-DD/,
      );
    });

    it('rejects malformed calendar dates', () => {
      expect(() => parseEffectiveDate('2024-13-01')).toThrow(/YYYY-MM-DD/);
      expect(() => parseEffectiveDate('24-01-15')).toThrow(/YYYY-MM-DD/);
      expect(() => parseEffectiveDate('')).toThrow(/YYYY-MM-DD/);
    });
  });
});
