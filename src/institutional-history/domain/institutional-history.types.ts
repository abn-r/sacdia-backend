export type InstitutionalEntityType =
  | 'division'
  | 'union'
  | 'local_field'
  | 'district'
  | 'church'
  | 'club';

export type HistoricalPrecision =
  | 'exact'
  | 'day'
  | 'month'
  | 'year'
  | 'system_backfill'
  | 'unknown';

export type TemporalRevision = {
  revisionId: string;
  validFrom: string;
  validTo: string | null;
  precision: HistoricalPrecision;
  recordedFrom: string;
  recordedTo: string | null;
  supersedesRevisionId: string | null;
};

export type EffectiveInterval = {
  validFrom: string;
  validTo: string | null;
};
