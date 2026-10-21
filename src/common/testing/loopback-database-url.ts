/**
 * Guard for destructive Postgres integration suites: the database URL must
 * resolve to a loopback server, never to a shared/remote database (Neon).
 *
 * `pg` lets query parameters (`?host=`, `?hostaddr=`) override the host of the
 * URL, so checking `new URL(url).hostname` alone is NOT enough:
 * `postgresql://u:p@localhost/db?host=ep-x.neon.tech` has a loopback hostname
 * yet connects to Neon. `pg-connection-string` is a transitive dependency of
 * `pg` (not resolvable under pnpm's strict layout), so the rules are applied
 * here directly, stricter than `pg`: EVERY host source must be loopback.
 */
const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1']);
const HOST_PARAMS = new Set(['host', 'hostaddr']);

const isLoopbackHost = (value: string): boolean => {
  const host = value
    .trim()
    .toLowerCase()
    .replace(/^\[|\]$/g, '');
  if (host.endsWith('.neon.tech')) return false;
  return LOOPBACK_HOSTS.has(host);
};

export function isLoopbackDatabaseUrl(databaseUrl: string): boolean {
  let url: URL;
  try {
    url = new URL(databaseUrl);
  } catch {
    return false;
  }
  if (url.protocol !== 'postgres:' && url.protocol !== 'postgresql:') {
    return false;
  }
  if (!isLoopbackHost(url.hostname)) return false;
  for (const [name, value] of url.searchParams) {
    if (!HOST_PARAMS.has(name.toLowerCase())) continue;
    // libpq accepts comma-separated host lists; an empty/unix-socket entry
    // is never loopback TCP, so it is rejected as well.
    if (!value || !value.split(',').every(isLoopbackHost)) return false;
  }
  return true;
}

export function assertLoopbackDatabaseUrl(
  databaseUrl: string,
  errorMessage: string,
): void {
  if (!isLoopbackDatabaseUrl(databaseUrl)) {
    throw new Error(errorMessage);
  }
}
