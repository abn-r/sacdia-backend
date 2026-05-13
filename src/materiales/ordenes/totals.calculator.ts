/**
 * Totals calculator — pure functions, no DI, no Prisma.
 * All money values are INTEGER centavos. No floats. No parseFloat.
 */

/**
 * Multiply unit price by quantity. Both values must be integers.
 * Returns an integer.
 */
export function computeLineTotal(
  price_centavos: number,
  qty: number,
): number {
  return price_centavos * qty;
}

/**
 * Sum all line_total_centavos values.
 * Returns an integer.
 */
export function computeSubtotal(
  lines: Array<{ line_total_centavos: number }>,
): number {
  return lines.reduce((acc, line) => acc + line.line_total_centavos, 0);
}

/**
 * Add subtotal and shipping cost.
 * Returns an integer.
 */
export function computeTotal(subtotal: number, envio: number): number {
  return subtotal + envio;
}
