import { loadCanonicalGeographicIanaTimezoneCatalog } from './canonical-geographic-iana-timezone';

describe('canonical geographic IANA timezone catalog', () => {
  const catalog = loadCanonicalGeographicIanaTimezoneCatalog();
  const supported = (timezone: string) => timezone !== 'Mars/Olympus';

  it('loads the pinned IANA 2026b sources and metadata', () => {
    expect(catalog.metadata).toMatchObject({
      version: '2026b',
      canonicalCount: 418,
      aliasCount: 151,
      sourceSha256:
        '4d8e389e5f4b0ec0466d5b14f42e5dfb0308c4376165fcf478339afd9ddcb00c',
      aliasSourceSha256:
        'd4b8a2bbebff0c9a396a29ea9552441854b49d68fc6375918671b7dfa0e17466',
    });
    expect(catalog.canonical.has('America/Argentina/Buenos_Aires')).toBe(true);
    expect(catalog.legacyAliases.has('America/Buenos_Aires')).toBe(true);
  });

  it.each([
    [null, 'MISSING', 'EMPTY'],
    [' ', 'MISSING', 'EMPTY'],
    ['EST', 'DISALLOWED_NAMESPACE', 'POSIX_IDENTIFIER'],
    ['CET', 'DISALLOWED_NAMESPACE', 'POSIX_IDENTIFIER'],
    ['HST', 'DISALLOWED_NAMESPACE', 'POSIX_IDENTIFIER'],
    ['MST', 'DISALLOWED_NAMESPACE', 'POSIX_IDENTIFIER'],
    ['+05:00', 'DISALLOWED_NAMESPACE', 'DISALLOWED_NAMESPACE'],
    ['Etc/GMT+5', 'DISALLOWED_NAMESPACE', 'DISALLOWED_NAMESPACE'],
    ['SystemV/EST5EDT', 'DISALLOWED_NAMESPACE', 'DISALLOWED_NAMESPACE'],
    ['Cuba', 'NON_CANONICAL', 'LEGACY_ALIAS'],
    ['PRC', 'NON_CANONICAL', 'LEGACY_ALIAS'],
    ['US/Eastern', 'NON_CANONICAL', 'LEGACY_ALIAS'],
    ['Mexico/General', 'NON_CANONICAL', 'LEGACY_ALIAS'],
    ['America/Buenos_Aires', 'NON_CANONICAL', 'LEGACY_ALIAS'],
    ['America/cancun', 'NON_CANONICAL', 'WRONG_CASE'],
    ['Mars/Olympus', 'UNKNOWN', 'NOT_IN_CATALOG'],
  ])('classifies %p as %s/%s', (value, reason, diagnostic) => {
    expect(catalog.classify(value, supported)).toEqual({
      ok: false,
      reason,
      diagnostic,
    });
  });

  it('separates canonical membership from runtime support', () => {
    expect(catalog.classify('America/Cancun', supported)).toEqual({
      ok: true,
      value: 'America/Cancun',
    });
    expect(catalog.classify('America/Cancun', () => false)).toEqual({
      ok: false,
      reason: 'UNKNOWN',
      diagnostic: 'RUNTIME_UNSUPPORTED',
    });
  });
});
