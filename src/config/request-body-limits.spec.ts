import {
  DEFAULT_JSON_BODY_LIMIT,
  DEFAULT_URLENCODED_BODY_LIMIT,
  LARGE_JSON_BODY_LIMIT,
  jsonBodyLimitForPath,
  pathnameNeedsLargeJsonBody,
  urlencodedBodyLimitForPath,
} from './request-body-limits';

describe('request-body-limits', () => {
  it('defaults JSON to 512kb for typical API routes', () => {
    expect(jsonBodyLimitForPath('/api/v1/auth/login')).toBe(
      DEFAULT_JSON_BODY_LIMIT,
    );
    expect(jsonBodyLimitForPath('/api/v1/clubs/1/members')).toBe(
      DEFAULT_JSON_BODY_LIMIT,
    );
  });

  it('allows large JSON only on explicit admin catalog prefixes', () => {
    expect(pathnameNeedsLargeJsonBody('/api/v1/admin/catalogs')).toBe(true);
    expect(pathnameNeedsLargeJsonBody('/api/v1/admin/catalogs/countries/1')).toBe(
      true,
    );
    expect(jsonBodyLimitForPath('/api/v1/admin/catalogs/unions')).toBe(
      LARGE_JSON_BODY_LIMIT,
    );
  });

  it('ignores query strings when classifying paths', () => {
    expect(
      pathnameNeedsLargeJsonBody('/api/v1/admin/catalogs/countries?lang=es'),
    ).toBe(true);
    expect(pathnameNeedsLargeJsonBody('/api/v1/users/me?expand=1')).toBe(false);
  });

  it('keeps urlencoded at the default limit', () => {
    expect(urlencodedBodyLimitForPath('/api/v1/auth/login')).toBe(
      DEFAULT_URLENCODED_BODY_LIMIT,
    );
  });
});
