import { createHash } from 'node:crypto';
import { closeSync, constants, fstatSync, openSync, readSync } from 'node:fs';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
export type TimezoneReason =
  | 'MISSING'
  | 'UNKNOWN'
  | 'NON_CANONICAL'
  | 'DISALLOWED_NAMESPACE';
export type TimezoneDiagnostic =
  | 'EMPTY'
  | 'POSIX_IDENTIFIER'
  | 'DISALLOWED_NAMESPACE'
  | 'LEGACY_ALIAS'
  | 'WRONG_CASE'
  | 'RUNTIME_UNSUPPORTED'
  | 'NOT_IN_CATALOG';
export type TimezoneClassification =
  | { ok: true; value: string }
  | { ok: false; reason: TimezoneReason; diagnostic: TimezoneDiagnostic };
export interface CanonicalGeographicIanaTimezoneCatalog {
  metadata: typeof PINNED_IANA_METADATA;
  canonical: ReadonlySet<string>;
  legacyAliases: ReadonlySet<string>;
  classify(
    value: unknown,
    supports?: (timezone: string) => boolean,
  ): TimezoneClassification;
}
export const PINNED_IANA_METADATA = Object.freeze({
  version: '2026b',
  source: 'iana-tzdb/zone.tab',
  sourceSha256:
    '4d8e389e5f4b0ec0466d5b14f42e5dfb0308c4376165fcf478339afd9ddcb00c',
  catalogSha256:
    '1d11c6fb6ca2c2a28fb846f6b27f8ba162015dc5261369bcc59c3026573027ff',
  canonicalCount: 418,
  aliasSource: 'iana-tzdb/2026b rearguard tzdata.zi links minus zone.tab',
  aliasSourceSha256:
    'd4b8a2bbebff0c9a396a29ea9552441854b49d68fc6375918671b7dfa0e17466',
  aliasCatalogSha256:
    '1776289046e4173b8c2024e891e21b80cf35a9e53990cbece38b3ceee39a69f2',
  aliasCount: 151,
} as const);
export function resolvePinnedIanaSourceDirectory(
  moduleDirectory = __dirname,
): string {
  return join(moduleDirectory, 'iana-tzdb-2026b');
}
export const PINNED_IANA_SOURCE_DIRECTORY = resolvePinnedIanaSourceDirectory();

const GEOGRAPHIC_ZONE =
  /^(?:Africa|America|Antarctica|Arctic|Asia|Atlantic|Australia|Europe|Indian|Pacific)\//;
const POSIX_IDENTIFIERS = new Set(
  'CET CST6CDT EET EST EST5EDT HST MET MST MST7MDT PST8PDT WET'.split(' '),
);
const MAX_COMPRESSED_SOURCE_BYTES = 65_536;
const MAX_DECOMPRESSED_SOURCE_BYTES = 262_144;

function sha256(value: string | Buffer): string {
  return createHash('sha256').update(value).digest('hex');
}

function assertSha(label: string, value: Buffer, expected: string): void {
  const actual = sha256(value);
  if (actual !== expected) {
    throw new Error(
      `${label} SHA-256 mismatch: expected ${expected}, got ${actual}`,
    );
  }
}

function sortedUnique(values: string[], label: string): string[] {
  const sorted = [...new Set(values)].sort();
  if (sorted.length !== values.length) {
    throw new Error(`${label} contains duplicate identifiers`);
  }
  return sorted;
}

function immutableSet(values: readonly string[]): ReadonlySet<string> {
  const source = new Set(values);
  const view: ReadonlySet<string> & { add(): never } = Object.freeze({
    get size() {
      return source.size;
    },
    has: (value: string) => source.has(value),
    entries: () => source.entries(),
    keys: () => source.keys(),
    values: () => source.values(),
    [Symbol.iterator]: () => source[Symbol.iterator](),
    forEach(
      callback: (
        value: string,
        duplicate: string,
        set: ReadonlySet<string>,
      ) => void,
      thisArg?: unknown,
    ) {
      source.forEach((value) => callback.call(thisArg, value, value, view));
    },
    add() {
      throw new TypeError('immutable timezone catalog');
    },
  });
  return view;
}

function readPinnedGzip(sourceDirectory: string, name: string): Buffer {
  const path = join(sourceDirectory, `${name}.gz`);
  const descriptor = openSync(
    path,
    constants.O_RDONLY | constants.O_NONBLOCK | constants.O_NOFOLLOW,
  );
  let compressed: Buffer;
  try {
    const initial = fstatSync(descriptor);
    if (!initial.isFile()) throw new Error(`${name}.gz must be a regular file`);
    if (initial.size > MAX_COMPRESSED_SOURCE_BYTES)
      throw new Error(`${name}.gz exceeds compressed size limit`);
    compressed = Buffer.alloc(initial.size);
    let offset = 0;
    while (offset < compressed.length) {
      const count = readSync(
        descriptor,
        compressed,
        offset,
        compressed.length - offset,
        offset,
      );
      if (count === 0) throw new Error(`${name}.gz changed while reading`);
      offset += count;
    }
    const final = fstatSync(descriptor);
    const trailing = Buffer.allocUnsafe(1);
    if (
      final.size !== initial.size ||
      readSync(descriptor, trailing, 0, 1, initial.size) !== 0
    )
      throw new Error(`${name}.gz changed while reading`);
  } finally {
    closeSync(descriptor);
  }
  try {
    return gunzipSync(compressed, {
      maxOutputLength: MAX_DECOMPRESSED_SOURCE_BYTES,
    });
  } catch (error) {
    throw new Error(
      `${name}.gz is invalid or exceeds ${MAX_DECOMPRESSED_SOURCE_BYTES} bytes`,
      { cause: error },
    );
  }
}

function parseZoneTab(source: string): string[] {
  const zones = source
    .split(/\r?\n/)
    .filter((line) => line && !line.startsWith('#'))
    .map((line) => line.trim().split(/\s+/)[2]);
  if (zones.some((zone) => !zone)) {
    throw new Error('zone.tab contains an invalid data row');
  }
  return sortedUnique(zones, 'zone.tab');
}

function parseAliases(
  source: string,
  canonical: ReadonlySet<string>,
): string[] {
  const aliases = source
    .split(/\r?\n/)
    .filter((line) => line.startsWith('L '))
    .map((line) => line.trim().split(/\s+/)[2])
    .filter((name): name is string => Boolean(name) && !canonical.has(name));
  return sortedUnique(aliases, 'tzdata.zi aliases');
}

export function verifyPinnedIanaSourceBytes(
  zoneTab: Buffer,
  tzdataZi: Buffer,
): void {
  assertSha('zone.tab', zoneTab, PINNED_IANA_METADATA.sourceSha256);
  assertSha('tzdata.zi', tzdataZi, PINNED_IANA_METADATA.aliasSourceSha256);
}

function supportsWithIntl(timezone: string): boolean {
  try {
    new Intl.DateTimeFormat('en', { timeZone: timezone });
    return true;
  } catch {
    return false;
  }
}

function invalid(
  reason: TimezoneReason,
  diagnostic: TimezoneDiagnostic,
): TimezoneClassification {
  return { ok: false, reason, diagnostic };
}

function classify(
  value: unknown,
  canonical: ReadonlySet<string>,
  aliases: ReadonlySet<string>,
  canonicalLower: ReadonlySet<string>,
  aliasLower: ReadonlySet<string>,
  supports: (timezone: string) => boolean,
): TimezoneClassification {
  if (typeof value !== 'string' || value.trim() === '') {
    return invalid('MISSING', 'EMPTY');
  }
  const lower = value.toLowerCase();
  const isPosix =
    POSIX_IDENTIFIERS.has(value.toUpperCase()) ||
    (/^[a-z]{2,5}$/i.test(value) && !aliasLower.has(lower));
  const isDisallowed =
    /^(?:Etc\/|SystemV\/|UTC(?:[+-].*)?$|GMT(?:[+-].*)?$|[+-]\d)/i.test(value);
  if (isDisallowed || isPosix) {
    return invalid(
      'DISALLOWED_NAMESPACE',
      isPosix ? 'POSIX_IDENTIFIER' : 'DISALLOWED_NAMESPACE',
    );
  }
  if (canonical.has(value)) {
    return supports(value)
      ? { ok: true, value }
      : invalid('UNKNOWN', 'RUNTIME_UNSUPPORTED');
  }
  if (canonicalLower.has(lower)) return invalid('NON_CANONICAL', 'WRONG_CASE');
  if (aliases.has(value) || aliasLower.has(lower)) {
    return invalid('NON_CANONICAL', 'LEGACY_ALIAS');
  }
  return supports(value)
    ? invalid('NON_CANONICAL', 'NOT_IN_CATALOG')
    : invalid('UNKNOWN', 'NOT_IN_CATALOG');
}

export function loadCanonicalGeographicIanaTimezoneCatalog(
  sourceDirectory = PINNED_IANA_SOURCE_DIRECTORY,
): CanonicalGeographicIanaTimezoneCatalog {
  const zoneTab = readPinnedGzip(sourceDirectory, 'zone.tab');
  const tzdataZi = readPinnedGzip(sourceDirectory, 'tzdata.zi');
  verifyPinnedIanaSourceBytes(zoneTab, tzdataZi);

  const canonicalValues = parseZoneTab(zoneTab.toString('utf8'));
  if (!canonicalValues.every((value) => GEOGRAPHIC_ZONE.test(value))) {
    throw new Error('zone.tab contains a non-geographic identifier');
  }
  const canonicalPayload = canonicalValues.join('|');
  if (
    canonicalValues.length !== PINNED_IANA_METADATA.canonicalCount ||
    sha256(canonicalPayload) !== PINNED_IANA_METADATA.catalogSha256
  ) {
    throw new Error('canonical timezone catalog integrity mismatch');
  }

  const canonicalSource = new Set(canonicalValues);
  const aliasValues = parseAliases(tzdataZi.toString('utf8'), canonicalSource);
  if (
    aliasValues.length !== PINNED_IANA_METADATA.aliasCount ||
    sha256(aliasValues.join('|')) !== PINNED_IANA_METADATA.aliasCatalogSha256
  ) {
    throw new Error('legacy timezone alias catalog integrity mismatch');
  }
  const legacyAliasSource = new Set(aliasValues);
  const canonicalLower = new Set(
    canonicalValues.map((value) => value.toLowerCase()),
  );
  const aliasLower = new Set(aliasValues.map((value) => value.toLowerCase()));
  return Object.freeze({
    metadata: PINNED_IANA_METADATA,
    canonical: immutableSet(canonicalValues),
    legacyAliases: immutableSet(aliasValues),
    classify: (value: unknown, supports = supportsWithIntl) =>
      classify(
        value,
        canonicalSource,
        legacyAliasSource,
        canonicalLower,
        aliasLower,
        supports,
      ),
  });
}
