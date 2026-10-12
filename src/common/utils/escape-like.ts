/**
 * Escapa `%`, `_` y `\` para usar un texto del usuario dentro de un `contains`
 * de Prisma. Sin esto, `%` o `_` actúan como comodín y la búsqueda devuelve
 * todos los registros. PostgreSQL usa la barra invertida como escape por
 * omisión en ILIKE.
 */
export function escapeLikeWildcards(value: string): string {
  return value.replace(/[\\%_]/g, (char) => `\\${char}`);
}
