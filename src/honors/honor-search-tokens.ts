import { Prisma } from '@prisma/client';
import { escapeLikeWildcards } from '../common/utils/escape-like';

/** Un token solo cuenta si mide al menos esto (las partículas cortas no buscan). */
export const HONOR_SEARCH_TOKEN_MIN = 3;

const STOPWORDS = new Set([
  'del',
  'las',
  'los',
  'una',
  'con',
  'por',
  'para',
  'the',
  'and',
  'for',
  'with',
]);

// El catálogo no tiene la extensión `unaccent` y no se crea una migración para
// eso: se quitan las tildes con `translate`, en el nombre y en la entrada.
// Las dos cadenas deben medir lo mismo.
const ACCENTS_FROM = 'ÁÀÄÂáàäâÉÈËÊéèëêÍÌÏÎíìïîÓÒÖÔóòöôÚÙÜÛúùüûÑñÇç';
const ACCENTS_TO = 'AAAAaaaaEEEEeeeeIIIIiiiiOOOOooooUUUUuuuuNnCc';

/** Minúsculas y sin tildes: lo mismo que hace `translate(...) ILIKE` en la base. */
export function foldAccents(text: string): string {
  return text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

/**
 * Tokens de la búsqueda: sin tildes, de 3 letras o más y sin palabras vacías
 * ("y", "de", "la", "del"…). Si no queda ninguno (por ejemplo, "de la" o "ab"),
 * se busca el texto completo como un único token.
 */
export function buildHonorSearchTokens(search: string): string[] {
  const folded = foldAccents(search).replace(/\s+/g, ' ').trim();
  const tokens = folded
    .split(' ')
    .map((token) => token.replace(/^[.,;:()"'-]+|[.,;:()"'-]+$/g, ''))
    .filter(
      (token) =>
        token.length >= HONOR_SEARCH_TOKEN_MIN && !STOPWORDS.has(token),
    );
  const unique = [...new Set(tokens)];
  return unique.length > 0 ? unique : folded ? [folded] : [];
}

/**
 * Raíz tosca para tolerar singular/plural y errores de final ("amarras" por
 * "Amarres", "natacion" por "Natación"): quita 1 letra a los tokens de 5 o 6 y 2
 * a los de 7 o más. La coincidencia es por subcadena, así que la raíz alcanza.
 */
export function stemHonorSearchToken(token: string): string {
  if (token.length >= 7) return token.slice(0, -2);
  if (token.length >= 5) return token.slice(0, -1);
  return token;
}

/**
 * Consulta parametrizada: ids de honores activos que coinciden con al menos un
 * token (en el nombre o en cualquier traducción) y cuántos tokens coinciden.
 * Todo valor del usuario viaja como parámetro; `%` y `_` van escapados.
 */
export function buildHonorSearchQuery(tokens: string[]): Prisma.Sql {
  const matches = tokens.map((token) => {
    const pattern = `%${escapeLikeWildcards(stemHonorSearchToken(token))}%`;
    return Prisma.sql`(
      translate(h.name, ${ACCENTS_FROM}, ${ACCENTS_TO}) ILIKE ${pattern}
      OR EXISTS (
        SELECT 1 FROM honors_translations t
        WHERE t.honor_id = h.honor_id
          AND translate(t.name, ${ACCENTS_FROM}, ${ACCENTS_TO}) ILIKE ${pattern}
      )
    )`;
  });
  const score = Prisma.join(
    matches.map((match) => Prisma.sql`(CASE WHEN ${match} THEN 1 ELSE 0 END)`),
    ' + ',
  );
  return Prisma.sql`
    SELECT h.honor_id AS honor_id, (${score})::int AS score
    FROM honors h
    WHERE h.active = true AND (${Prisma.join(matches, ' OR ')})
  `;
}

/**
 * Se queda con los que coinciden con TODOS los tokens; si no hay ninguno, con los
 * que coinciden con cualquiera. Ordena por tokens coincidentes, de mayor a menor.
 */
export function pickHonorSearchMatches(
  rows: Array<{ honor_id: number; score: number }>,
  tokenCount: number,
): Array<{ honorId: number; score: number }> {
  const all = rows.filter((row) => row.score >= tokenCount);
  return (all.length > 0 ? all : rows)
    .map((row) => ({ honorId: row.honor_id, score: row.score }))
    .sort((a, b) => b.score - a.score);
}
