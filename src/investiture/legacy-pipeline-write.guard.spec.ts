import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

const SRC = join(process.cwd(), 'src');

/**
 * Formas de ESCRITURA con las que la vía vieja fijaba estados y acciones.
 * Exigen el par `clave: valor`; una comparación (`=== …APPROVED`), una lista
 * (`in: [...]`) o un `select` no las cumplen.
 */
const FORBIDDEN = [
  /\b(?:investiture_status|action)\s*:\s*investiture_(?:status|action)_enum\.(?:SUBMITTED_FOR_VALIDATION|CLUB_APPROVED|COORDINATOR_APPROVED|FIELD_APPROVED|APPROVED|SUBMITTED)\b/g,
  /\binvestiture_status\s*:\s*['"](?:SUBMITTED_FOR_VALIDATION|CLUB_APPROVED|COORDINATOR_APPROVED|FIELD_APPROVED|APPROVED)['"]/g,
];

/** Solo lectura: el tablero SLA filtra la historia ya grabada (`where: { action: FIELD_APPROVED }`). */
const READ_ONLY_ALLOWLIST = new Set(['analytics/analytics.service.ts']);

function sources(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return sources(path);
    return entry.name.endsWith('.ts') && !entry.name.endsWith('.spec.ts')
      ? [path]
      : [];
  });
}

const matches = (text: string) =>
  FORBIDDEN.flatMap((pattern) => [...text.matchAll(pattern)]);

describe('legacy investiture pipeline stays off', () => {
  it.each([
    'investiture_status: investiture_status_enum.CLUB_APPROVED',
    'action:\n    investiture_action_enum.SUBMITTED',
    "investiture_status: 'APPROVED'",
    'investiture_status: "FIELD_APPROVED"',
  ])('flags the write shape %j', (sample) => {
    expect(matches(sample)).toHaveLength(1);
  });

  it.each([
    'e.investiture_status === investiture_status_enum.APPROVED',
    'investiture_status: { in: [investiture_status_enum.INVESTIDO, investiture_status_enum.APPROVED] }',
    'investiture_status: investiture_status_enum.INVESTIDO',
    "investiture_status: 'INVESTIDO'",
    'action: investiture_action_enum.EXPIRED',
    'action: investiture_action_enum.LEGACY_LOCK_RELEASED',
    'submitted_for_validation: true',
  ])('ignores the read or still-valid shape %j', (sample) => {
    expect(matches(sample)).toHaveLength(0);
  });

  it('no production file writes a legacy pipeline state or action', () => {
    const offenders: string[] = [];
    for (const path of sources(SRC)) {
      const file = relative(SRC, path).split(sep).join('/');
      if (READ_ONLY_ALLOWLIST.has(file)) continue;
      const text = readFileSync(path, 'utf8');
      for (const match of matches(text)) {
        const line = text.slice(0, match.index).split('\n').length;
        offenders.push(`${file}:${line}: ${match[0].replace(/\s+/g, ' ')}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
