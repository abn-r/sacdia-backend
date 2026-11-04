import { TENANT_BINDING_ALLOWLIST } from './tenant-binding-allowlist';

/**
 * RATCHET: tenant-binding-allowlist can only shrink.
 *
 * The allowlist is a frozen list of routes that still lack `bind`. This spec
 * pins its size (total and per marker). Adding entries fails the build; removing
 * entries also fails until FROZEN_* are lowered here, so every reduction is
 * recorded and can never silently grow back.
 *
 * Markers are the reason strings of the allowlist constants (they are not
 * exported), identified here by a stable prefix of their text.
 */
const MARKER_PREFIXES: Readonly<Record<string, string>> = {
  PENDING_REVIEW: 'Pending tenant-binding review',
};

const FROZEN_TOTAL = 13;
const FROZEN_BY_MARKER: Readonly<Record<string, number>> = {
  PENDING_REVIEW: 13,
};

const RAISED =
  'No agregues rutas a tenant-binding-allowlist. Declara `bind` en @AuthorizationResource o una policy de recurso.';
const lowered = (n: number) =>
  `La allowlist bajó a ${n}. Baja FROZEN_* en este spec para fijar el nuevo mínimo.`;

function countByMarker(): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const name of Object.keys(MARKER_PREFIXES)) counts[name] = 0;
  counts.UNKNOWN = 0;
  for (const reason of Object.values(TENANT_BINDING_ALLOWLIST)) {
    const name =
      Object.keys(MARKER_PREFIXES).find((k) =>
        reason.startsWith(MARKER_PREFIXES[k]),
      ) ?? 'UNKNOWN';
    counts[name] += 1;
  }
  return counts;
}

function check(actual: number, frozen: number, label: string) {
  if (actual > frozen) {
    throw new Error(`${RAISED} (${label}: ${actual} > ${frozen})`);
  }
  if (actual < frozen) {
    throw new Error(`${lowered(actual)} (${label}: ${frozen} -> ${actual})`);
  }
}

describe('tenant-binding-allowlist freeze (ratchet)', () => {
  const counts = countByMarker();

  it('has no entries with an unknown marker', () => {
    expect(counts.UNKNOWN).toBe(0);
  });

  it('total does not move', () => {
    check(Object.keys(TENANT_BINDING_ALLOWLIST).length, FROZEN_TOTAL, 'total');
  });

  it.each(Object.keys(FROZEN_BY_MARKER))('marker %s does not move', (name) => {
    check(counts[name], FROZEN_BY_MARKER[name], name);
  });

  it('FROZEN_BY_MARKER sums to FROZEN_TOTAL', () => {
    const sum = Object.values(FROZEN_BY_MARKER).reduce((a, b) => a + b, 0);
    expect(sum).toBe(FROZEN_TOTAL);
  });
});
