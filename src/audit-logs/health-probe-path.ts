/**
 * Paths of the public liveness probe. The platform (e.g. Render) polls it every
 * few seconds, so per-request application log lines for it are pure noise.
 *
 * `/api/v1/health/details` is intentionally NOT a probe path: it is
 * admin-only and worth keeping in the logs.
 */
export const HEALTH_PROBE_PATHS: readonly string[] = [
  '/api/v1/health',
  '/health',
];

/**
 * True when the request URL (query string and trailing slashes ignored) is
 * exactly one of the public health probe paths.
 */
export function isHealthProbePath(url: string | undefined | null): boolean {
  if (!url) return false;
  const pathname = url.split('?')[0].replace(/\/+$/, '').toLowerCase();
  return HEALTH_PROBE_PATHS.includes(pathname);
}
