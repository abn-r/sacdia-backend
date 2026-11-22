/**
 * Coincidencia exacta (sin difusos) entre el nombre que leyó el OCR y el
 * catálogo de especialidades que el miembro puede elegir.
 */

export const HONOR_AUTO_MATCH_KEY = 'honor_auto_match';

/**
 * Con esta confianza de fecha o más, una fila con especialidad elegida por el
 * auto-match queda lista para enviar. Debajo, el miembro confirma la fecha
 * (la app usa el mismo umbral para su aviso «Revisa la fecha»).
 */
export const AUTO_MATCH_READY_DATE_CONFIDENCE = 0.8;

/** Recorta, pasa a minúsculas, quita tildes y colapsa espacios internos. */
export function normalizeHonorName(value: string | null | undefined): string {
  return (value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

export type HonorNameIndex = Map<string, number[]>;

export function buildHonorNameIndex(
  honors: ReadonlyArray<{ honor_id: number; name: string }>,
): HonorNameIndex {
  const index: HonorNameIndex = new Map();
  for (const honor of honors) {
    const key = normalizeHonorName(honor.name);
    if (!key) continue;
    const ids = index.get(key);
    if (ids) ids.push(honor.honor_id);
    else index.set(key, [honor.honor_id]);
  }
  return index;
}

/** El id solo si el nombre coincide con exactamente un honor; si no, null. */
export function matchHonorId(
  index: HonorNameIndex,
  detectedName: string | null | undefined,
): number | null {
  const key = normalizeHonorName(detectedName);
  if (!key) return null;
  const ids = index.get(key);
  return ids && ids.length === 1 ? ids[0] : null;
}

/** Fila intacta cuya elección vino solo del auto-match. */
export function isAutoMatchedFieldConfidence(value: unknown): boolean {
  return (
    !!value &&
    typeof value === 'object' &&
    (value as Record<string, unknown>)[HONOR_AUTO_MATCH_KEY] === 1
  );
}
