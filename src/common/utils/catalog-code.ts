/**
 * Server-side `code` generation for catalogs whose admin form only sends a
 * (translated) name, e.g. activity types and camporee event types.
 */

const FALLBACK_CODE = 'TYPE';
const MAX_UNIQUE_ATTEMPTS = 100;

/**
 * "Reunión de Líderes!" -> "REUNION_DE_LIDERES". Uppercase, accents stripped,
 * every run of non-alphanumerics collapsed into a single `_`, trimmed and cut
 * to `maxLength`.
 */
export function deriveCatalogCode(name: string, maxLength: number): string {
  const slug = name
    .normalize('NFD')
    .replace(/\p{M}+/gu, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, maxLength)
    .replace(/_+$/g, '');

  return slug || FALLBACK_CODE.slice(0, maxLength);
}

/**
 * Derives a code from `name` and appends `_2`, `_3`... until `isTaken` says
 * the candidate is free. The base is shortened so the suffix still fits in
 * `maxLength`. Returns `null` only if every attempt is taken.
 */
export async function deriveUniqueCatalogCode(
  name: string,
  maxLength: number,
  isTaken: (candidate: string) => Promise<boolean>,
): Promise<string | null> {
  const base = deriveCatalogCode(name, maxLength);

  if (!(await isTaken(base))) {
    return base;
  }

  for (let n = 2; n <= MAX_UNIQUE_ATTEMPTS; n++) {
    const suffix = `_${n}`;
    const candidate = `${base.slice(0, maxLength - suffix.length).replace(/_+$/g, '')}${suffix}`;
    if (!(await isTaken(candidate))) {
      return candidate;
    }
  }

  return null;
}
