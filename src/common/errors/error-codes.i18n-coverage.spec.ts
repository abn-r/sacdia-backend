import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ErrorCode } from './error-codes';

/**
 * Every ErrorCode needs a message in the 4 locales. Without one, the global
 * exception filter answers the raw key (`errors.SOME_CODE`) and the admin and
 * the app show it to the user as is.
 */

const LOCALES = ['es', 'en', 'fr', 'pt-BR'] as const;

const load = (locale: string): Record<string, string> =>
  JSON.parse(
    readFileSync(join(__dirname, `../../i18n/${locale}/errors.json`), 'utf8'),
  ) as Record<string, string>;

const placeholders = (message: string): string[] =>
  [...new Set([...message.matchAll(/\{(\w+)\}/g)].map((m) => m[1]))].sort();

const CODES = Object.values(ErrorCode);

describe('ErrorCode i18n coverage', () => {
  it.each(LOCALES)('every ErrorCode has a message in %s', (locale) => {
    const catalog = load(locale);
    const missing = CODES.filter((code) => !catalog[code]?.trim());
    expect(missing).toEqual([]);
  });

  it('every code uses the same placeholders in all locales', () => {
    const catalogs = LOCALES.map((locale) => load(locale));
    const mismatched = CODES.filter((code) => {
      const sets = catalogs.map((catalog) =>
        placeholders(catalog[code] ?? '').join(','),
      );
      return new Set(sets).size > 1;
    });
    expect(mismatched).toEqual([]);
  });
});
