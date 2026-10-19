import type { DependentConsentState } from './consent-gate.service';

/** Default pending timeout (system_config membership.pending_timeout_days). */
export const DEFAULT_PENDING_TIMEOUT_DAYS = 8;

/**
 * Requests of a dependent whose guardian consent is still pending live this
 * long (ruling #11518): the paper form travels through the guardian and the
 * director, so the normal timeout is too short.
 */
export const DEPENDENT_CONSENT_PENDING_TIMEOUT_DAYS = 30;

/** `system_config.config_value` to a usable day count; garbage falls back to the default. */
export function parsePendingTimeoutDays(
  configValue: string | undefined,
): number {
  if (configValue === undefined) return DEFAULT_PENDING_TIMEOUT_DAYS;
  const days = parseInt(configValue, 10);
  return Number.isFinite(days) ? days : DEFAULT_PENDING_TIMEOUT_DAYS;
}

export function addDays(from: Date, days: number): Date {
  const result = new Date(from);
  result.setUTCDate(result.getUTCDate() + days);
  return result;
}

/**
 * The instant a pending membership request expires (it is expired once `now`
 * is strictly past it). Single source of truth for the cron and for the
 * `effective_expires_at` shown to directors (FP-40, rulings A1/A11):
 *  - not a dependent (`consent` undefined): created_at + base timeout;
 *  - dependent, consent NOT verified: created_at + max(base, 30) days;
 *  - dependent, consent verified: the base timeout restarts, counted from
 *    max(created_at, verified_at).
 */
export function effectiveMembershipExpiry(input: {
  createdAt: Date;
  timeoutDays: number;
  consent: DependentConsentState | undefined;
}): Date {
  const { createdAt, timeoutDays, consent } = input;
  if (!consent) return addDays(createdAt, timeoutDays);
  if (!consent.verifiedAt) {
    return addDays(
      createdAt,
      Math.max(timeoutDays, DEPENDENT_CONSENT_PENDING_TIMEOUT_DAYS),
    );
  }
  const clockStart =
    consent.verifiedAt > createdAt ? consent.verifiedAt : createdAt;
  return addDays(clockStart, timeoutDays);
}

export function isMembershipRequestExpired(
  input: Parameters<typeof effectiveMembershipExpiry>[0],
  now: Date,
): boolean {
  return effectiveMembershipExpiry(input) < now;
}
