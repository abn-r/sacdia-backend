/**
 * Review target for the evidence queue (class sections SUBMITTED + honors
 * PENDING_REVIEW): an item waiting this many whole days or more since
 * `submitted_at` is overdue.
 *
 * Single source of truth. The SLA dashboard returns it as
 * `evidence.overdue_threshold_days` so clients do not hardcode it.
 */
export const EVIDENCE_REVIEW_OVERDUE_DAYS = 7;

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** Latest `submitted_at` that already counts as overdue at `now`. */
export function evidenceOverdueCutoff(now: Date): Date {
  return new Date(now.getTime() - EVIDENCE_REVIEW_OVERDUE_DAYS * MS_PER_DAY);
}
