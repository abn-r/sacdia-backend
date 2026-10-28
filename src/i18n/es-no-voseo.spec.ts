import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';

/**
 * Spanish copy must use tú, never voseo ("Cerrá", "Ejecutá", "Tenés"...).
 * Voseo imperatives and present forms are the only common words that end in a
 * stressed á/é/í (or -és/-ís for the present), so the check flags those and
 * allows the legitimate ones explicitly.
 */

const ES_DIR = join(__dirname, 'es');

const ALLOWED_STRESSED_ENDINGS = new Set([
  'está',
  'esté',
  'qué',
  'sé',
  'té',
  'café',
  'así',
  'aquí',
  'allí',
  'ahí',
  'sí',
  'después',
  'además',
  'país',
  'países',
]);

const VOSEO_WORDS =
  /^(vos|sos|acá|vení|fijate|dale|che|tenés|podés|querés|sabés|decís|hacés|ponés|andás|estás)$/i;

function collectStrings(value: unknown, path: string, out: [string, string][]) {
  if (typeof value === 'string') {
    out.push([path, value]);
  } else if (value && typeof value === 'object') {
    for (const [key, child] of Object.entries(value)) {
      collectStrings(child, `${path}.${key}`, out);
    }
  }
}

function isVoseo(word: string): boolean {
  const lower = word.toLowerCase();
  if (VOSEO_WORDS.test(lower)) return true;
  if (ALLOWED_STRESSED_ENDINGS.has(lower)) return false;
  // Future tense (-rá: cambiará, asistirá) is regular, not voseo.
  if (/\p{L}rá$/u.test(lower)) return false;
  return /\p{L}[áéí]$/u.test(lower);
}

describe('Spanish i18n copy', () => {
  const files = readdirSync(ES_DIR).filter((name) => name.endsWith('.json'));

  it.each(files)('%s uses tú, not voseo', (file) => {
    const entries: [string, string][] = [];
    collectStrings(
      JSON.parse(readFileSync(join(ES_DIR, file), 'utf8')),
      file,
      entries,
    );

    const offenders = entries.flatMap(([path, text]) =>
      (text.match(/\p{L}+/gu) ?? [])
        .filter(isVoseo)
        .map((word) => `${path}: ${word}`),
    );

    expect(offenders).toEqual([]);
  });
});
