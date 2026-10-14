/**
 * Shared parsing for the "Redis is down" degradation flags. ConfigService
 * values are already coerced by Joi (env.validation.ts) at boot, but the
 * helpers also accept raw strings so unit tests and ad-hoc readers behave the
 * same way.
 */

export type ThrottlerRedisFallback = 'closed' | 'memory' | 'open';
export type AuthBlacklistDegradedMode = 'db-session' | 'reject' | 'allow';

export const THROTTLER_REDIS_FALLBACKS: readonly ThrottlerRedisFallback[] = [
  'closed',
  'memory',
  'open',
];
export const AUTH_BLACKLIST_DEGRADED_MODES: readonly AuthBlacklistDegradedMode[] =
  ['db-session', 'reject', 'allow'];

export const DEFAULT_THROTTLER_REDIS_FALLBACK: ThrottlerRedisFallback =
  'closed';
export const DEFAULT_AUTH_BLACKLIST_DEGRADED_MODE: AuthBlacklistDegradedMode =
  'db-session';

/** Only an explicit true/'true' enables the flag. */
export function isTrueFlag(value: unknown): boolean {
  return value === true || String(value).trim().toLowerCase() === 'true';
}

/**
 * REDIS_BOOT_OPTIONAL (default false). When true, a Redis outage at boot is
 * logged and the API still starts instead of aborting.
 */
export function isRedisBootOptional(value: unknown): boolean {
  return isTrueFlag(value);
}

/**
 * Precedence: an explicit THROTTLER_REDIS_FALLBACK always wins. When it is
 * unset, the legacy THROTTLER_FAIL_OPEN=true maps to 'open'; otherwise the
 * default is fail-closed. (env.validation.ts rejects FAIL_OPEN=true combined
 * with a non-'open' fallback, so the two can never disagree in a booted app.)
 */
export function resolveThrottlerFallback(
  fallback: unknown,
  failOpen: unknown,
): ThrottlerRedisFallback {
  const normalized =
    typeof fallback === 'string' ? fallback.trim().toLowerCase() : '';
  if ((THROTTLER_REDIS_FALLBACKS as readonly string[]).includes(normalized)) {
    return normalized as ThrottlerRedisFallback;
  }
  return isTrueFlag(failOpen) ? 'open' : DEFAULT_THROTTLER_REDIS_FALLBACK;
}

export function resolveAuthBlacklistDegradedMode(
  value: unknown,
): AuthBlacklistDegradedMode {
  const normalized =
    typeof value === 'string' ? value.trim().toLowerCase() : '';
  return (AUTH_BLACKLIST_DEGRADED_MODES as readonly string[]).includes(
    normalized,
  )
    ? (normalized as AuthBlacklistDegradedMode)
    : DEFAULT_AUTH_BLACKLIST_DEGRADED_MODE;
}
