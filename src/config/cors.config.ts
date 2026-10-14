export interface CorsRejectionLogger {
  warn(message: string): void;
}

export type CorsOriginCallback = (error: Error | null, allow?: boolean) => void;

/** One warn line per distinct rejected origin per window. */
export const CORS_REJECTION_LOG_WINDOW_MS = 10 * 60 * 1000;

/** Hard cap on tracked origins so hostile traffic cannot grow the map. */
const MAX_TRACKED_ORIGINS = 500;

/**
 * Builds the `origin` callback for `app.enableCors`.
 *
 * - Requests without an Origin header (health checks, server-to-server, curl,
 *   mobile clients) are allowed: CORS is browser-only and auth is enforced by
 *   the JWT guards.
 * - Allowed origins are matched EXACTLY (no wildcards, no suffix matching).
 * - A disallowed origin is rejected with `callback(null, false)`: the cors
 *   middleware simply omits the CORS headers (the browser blocks the call) and
 *   the preflight gets a normal 204 instead of an Error reaching Express as an
 *   unhandled 500. Rejections are logged at most once per origin per window,
 *   with the origin value only.
 */
export function buildCorsOriginCallback(
  allowedOrigins: readonly string[],
  logger: CorsRejectionLogger,
  options: { windowMs?: number; now?: () => number } = {},
): (origin: string | undefined, callback: CorsOriginCallback) => void {
  const allowed = new Set(allowedOrigins);
  const windowMs = options.windowMs ?? CORS_REJECTION_LOG_WINDOW_MS;
  const now = options.now ?? Date.now;
  const lastLoggedAt = new Map<string, number>();

  const shouldLog = (origin: string): boolean => {
    const current = now();
    const last = lastLoggedAt.get(origin);
    if (last !== undefined && current - last < windowMs) {
      return false;
    }
    if (lastLoggedAt.size >= MAX_TRACKED_ORIGINS) {
      for (const [key, ts] of lastLoggedAt) {
        if (current - ts >= windowMs) lastLoggedAt.delete(key);
      }
      if (lastLoggedAt.size >= MAX_TRACKED_ORIGINS) {
        // Still full of fresh entries: drop the oldest (insertion order).
        const oldest = lastLoggedAt.keys().next().value;
        if (oldest !== undefined) lastLoggedAt.delete(oldest);
      }
    }
    lastLoggedAt.set(origin, current);
    return true;
  };

  return (origin, callback) => {
    if (!origin || allowed.has(origin)) {
      callback(null, true);
      return;
    }
    if (shouldLog(origin)) {
      logger.warn(
        `CORS origin rejected: ${JSON.stringify(origin.slice(0, 200))}`,
      );
    }
    callback(null, false);
  };
}
