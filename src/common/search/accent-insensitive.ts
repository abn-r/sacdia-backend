import { Prisma } from '@prisma/client';

/**
 * Accent-insensitive name search without the `unaccent` extension.
 *
 * The database has no `unaccent`, and `lower()`/`ILIKE` only fold ASCII under
 * the C collation. So both sides are folded to plain ASCII letters: the search
 * term in JS, the column in SQL with `translate()` over the accented letters
 * used in Spanish, Portuguese and French names. The folded column is then
 * compared with ILIKE, which is safe once every letter is ASCII.
 */
const ACCENTED = 'ÁÀÂÄÃÅáàâäãåÉÈÊËéèêëÍÌÎÏíìîïÓÒÔÖÕóòôöõÚÙÛÜúùûüÑñÇçÝýÿ';
const PLAIN = 'AAAAAAaaaaaaEEEEeeeeIIIIiiiiOOOOOoooooUUUUuuuuNnCcYyy';

/** Folds a search term to the same ASCII form as `foldedColumnSql`. */
export function foldAccents(value: string): string {
  return value.normalize('NFD').replace(/\p{M}/gu, '');
}

/** Escapes LIKE wildcards so a term matches literally. */
export function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (char) => `\\${char}`);
}

/** `translate(column, accented, plain)`; `column` must be a trusted identifier. */
export function foldedColumnSql(column: string): Prisma.Sql {
  if (!/^[A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z_][A-Za-z0-9_]*)?$/.test(column)) {
    throw new Error(`Unsafe SQL column: ${JSON.stringify(column)}`);
  }
  return Prisma.sql`translate(coalesce(${Prisma.raw(column)}, ''), ${ACCENTED}, ${PLAIN})`;
}

/**
 * Splits a free-text query into folded words. Every word must then match at
 * least one of the searched columns (AND across words, OR across columns).
 */
export function searchTokens(query: string | undefined): string[] {
  return (query ?? '').trim().split(/\s+/).filter(Boolean).map(foldAccents);
}

/**
 * SQL predicate: every token appears in at least one of `columns`, ignoring
 * case and accents. Returns `TRUE` when there are no tokens.
 */
export function accentInsensitiveMatchSql(
  columns: readonly string[],
  tokens: readonly string[],
): Prisma.Sql {
  if (tokens.length === 0 || columns.length === 0) return Prisma.sql`TRUE`;
  const folded = columns.map(foldedColumnSql);
  const perToken = tokens.map((token) => {
    const pattern = `%${escapeLike(token)}%`;
    return Prisma.sql`(${Prisma.join(
      folded.map((col) => Prisma.sql`${col} ILIKE ${pattern}`),
      ' OR ',
    )})`;
  });
  return Prisma.join(perToken, ' AND ');
}
