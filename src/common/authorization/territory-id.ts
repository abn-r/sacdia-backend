/**
 * Positive territory id from a number or a numeric string; anything else is
 * `undefined`. Shared by ActorScope and actor-territory-scope (which
 * re-exports it) so both read ids the same way.
 */
export function toTerritoryId(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    return value;
  }

  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    if (Number.isFinite(parsed) && parsed > 0) {
      return parsed;
    }
  }

  return undefined;
}
