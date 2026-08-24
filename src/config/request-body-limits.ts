/** Typical JSON/urlencoded bodies — registration, CRUD, filters. */
export const DEFAULT_JSON_BODY_LIMIT = '512kb';
export const DEFAULT_URLENCODED_BODY_LIMIT = '512kb';

/**
 * Multipart uploads use Multer (AppModule), not these parsers.
 * Reserved for rare JSON endpoints that must exceed the default (add explicitly).
 */
export const LARGE_JSON_BODY_LIMIT = '10mb';

const LARGE_JSON_PATH_PREFIXES = [
  // Admin catalog writes may include translation maps for several locales.
  '/api/v1/admin/catalogs',
] as const;

function normalizePathname(pathname: string): string {
  const withoutQuery = pathname.split('?')[0] ?? pathname;
  if (withoutQuery.length > 1 && withoutQuery.endsWith('/')) {
    return withoutQuery.slice(0, -1);
  }
  return withoutQuery;
}

export function pathnameNeedsLargeJsonBody(pathname: string): boolean {
  const normalized = normalizePathname(pathname);
  return LARGE_JSON_PATH_PREFIXES.some(
    (prefix) =>
      normalized === prefix || normalized.startsWith(`${prefix}/`),
  );
}

export function jsonBodyLimitForPath(pathname: string): string {
  return pathnameNeedsLargeJsonBody(pathname)
    ? LARGE_JSON_BODY_LIMIT
    : DEFAULT_JSON_BODY_LIMIT;
}

export function urlencodedBodyLimitForPath(_pathname: string): string {
  return DEFAULT_URLENCODED_BODY_LIMIT;
}
