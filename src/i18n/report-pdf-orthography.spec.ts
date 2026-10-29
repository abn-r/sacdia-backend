import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * The PDF reports render these strings as is. Unaccented spellings slipped in
 * before ("Ano Eclesiastico", "ENSENANZAS", "Pagina"); keep them out.
 */
const FILES = ['monthly_reports', 'quarterly_reports', 'annual_reports'];

const FORBIDDEN: Record<string, RegExp[]> = {
  es: [
    /\bano\b/i,
    /ENSENANZA/,
    /\b\w+cion\b/i,
    /\bPagina\b/,
    /\bDias\b/,
    /\bbiblic/i,
    /desempeno/,
    /^Si$/,
    /\bmas$/,
  ],
  'pt-BR': [
    /\b\w+cao\b/i,
    /\b\w+coes\b/i,
    /\bNao\b/i,
    /\bmes\b/i,
    /\bPagina\b/,
    /\bRELATORIO\b/,
    /\bbiblic/i,
  ],
};

function strings(value: unknown): string[] {
  if (typeof value === 'string') return [value];
  if (value && typeof value === 'object') {
    return Object.values(value as Record<string, unknown>).flatMap(strings);
  }
  return [];
}

describe('report PDF strings keep their accents', () => {
  for (const [locale, patterns] of Object.entries(FORBIDDEN)) {
    for (const file of FILES) {
      it(`${locale}/${file}`, () => {
        const json = JSON.parse(
          readFileSync(join(__dirname, locale, `${file}.json`), 'utf8'),
        ) as unknown;
        const offenders = strings(json).filter((text) =>
          patterns.some((pattern) => pattern.test(text)),
        );
        expect(offenders).toEqual([]);
      });
    }
  }
});
