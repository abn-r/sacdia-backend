import type {
  EffectiveInterval,
  HistoricalPrecision,
  TemporalRevision,
} from './institutional-history.types';

export type {
  EffectiveInterval,
  HistoricalPrecision,
  InstitutionalEntityType,
  TemporalRevision,
} from './institutional-history.types';

export const HISTORICAL_PRECISIONS: readonly HistoricalPrecision[] = [
  'exact',
  'day',
  'month',
  'year',
  'system_backfill',
  'unknown',
] as const;

const EFFECTIVE_DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

export function isHistoricalPrecision(
  value: string,
): value is HistoricalPrecision {
  return (HISTORICAL_PRECISIONS as readonly string[]).includes(value);
}

export function parseEffectiveDate(value: string): string {
  const match = EFFECTIVE_DATE_RE.exec(value);
  if (!match) {
    throw new Error('Effective date must be YYYY-MM-DD');
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const parsed = new Date(Date.UTC(year, month - 1, day));

  if (
    parsed.getUTCFullYear() !== year ||
    parsed.getUTCMonth() !== month - 1 ||
    parsed.getUTCDate() !== day
  ) {
    throw new Error('Effective date must be YYYY-MM-DD');
  }

  return value;
}

export function assertValidEffectiveInterval(
  interval: EffectiveInterval,
): void {
  const validFrom = parseEffectiveDate(interval.validFrom);
  if (interval.validTo === null) {
    return;
  }

  const validTo = parseEffectiveDate(interval.validTo);
  if (validTo <= validFrom) {
    throw new Error('valid_to must be strictly after valid_from');
  }
}

export function containsEffectiveInstant(
  interval: EffectiveInterval,
  instant: string,
): boolean {
  assertValidEffectiveInterval(interval);
  const asOf = parseEffectiveDate(instant);
  if (asOf < interval.validFrom) {
    return false;
  }
  if (interval.validTo === null) {
    return true;
  }
  return asOf < interval.validTo;
}

export function createCorrectionRevision(
  previous: TemporalRevision,
  next: Pick<
    TemporalRevision,
    'revisionId' | 'validFrom' | 'validTo' | 'precision' | 'recordedFrom'
  >,
): TemporalRevision {
  assertValidEffectiveInterval({
    validFrom: next.validFrom,
    validTo: next.validTo,
  });
  if (!isHistoricalPrecision(next.precision)) {
    throw new Error('Invalid historical precision');
  }

  return {
    revisionId: next.revisionId,
    validFrom: next.validFrom,
    validTo: next.validTo,
    precision: next.precision,
    recordedFrom: next.recordedFrom,
    recordedTo: null,
    supersedesRevisionId: previous.revisionId,
  };
}
