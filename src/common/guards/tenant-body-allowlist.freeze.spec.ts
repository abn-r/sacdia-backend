import { TENANT_BODY_ALLOWLIST } from './tenant-body-allowlist';

/**
 * RATCHET: tenant-body-allowlist can only shrink.
 *
 * Frozen list of routes that read a tenant id from the body/query without a
 * matching `bind`. This spec pins its size (total and per marker). Adding
 * entries fails the build; removing entries also fails until FROZEN_* are
 * lowered here, so every reduction is recorded and can never silently grow
 * back. Markers are the reason strings, identified by a stable text prefix.
 */
const MARKER_PREFIXES: Readonly<Record<string, string>> = {
  PENDING_BODY_REVIEW: 'Pending body/query tenant-binding review',
};

const FROZEN_TOTAL = 55;
const FROZEN_BY_MARKER: Readonly<Record<string, number>> = {
  PENDING_BODY_REVIEW: 55,
};

const RAISED =
  'No agregues rutas a tenant-body-allowlist. Declara `bind` (source body/query) en @AuthorizationResource.';
const lowered = (n: number) =>
  `La allowlist bajó a ${n}. Baja FROZEN_* en este spec para fijar el nuevo mínimo.`;

function countByMarker(): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const name of Object.keys(MARKER_PREFIXES)) counts[name] = 0;
  counts.UNKNOWN = 0;
  for (const reason of Object.values(TENANT_BODY_ALLOWLIST)) {
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

describe('tenant-body-allowlist freeze (ratchet)', () => {
  const counts = countByMarker();

  it('has no entries with an unknown marker', () => {
    expect(counts.UNKNOWN).toBe(0);
  });

  it('total does not move', () => {
    check(Object.keys(TENANT_BODY_ALLOWLIST).length, FROZEN_TOTAL, 'total');
  });

  it.each(Object.keys(FROZEN_BY_MARKER))('marker %s does not move', (name) => {
    check(counts[name], FROZEN_BY_MARKER[name], name);
  });

  it('FROZEN_BY_MARKER sums to FROZEN_TOTAL', () => {
    const sum = Object.values(FROZEN_BY_MARKER).reduce((a, b) => a + b, 0);
    expect(sum).toBe(FROZEN_TOTAL);
  });
});
