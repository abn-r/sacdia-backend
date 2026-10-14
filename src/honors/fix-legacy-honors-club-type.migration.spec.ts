import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const migration = readFileSync(
  join(
    __dirname,
    '../../prisma/migrations/20261014100000_fix_legacy_honors_club_type/migration.sql',
  ),
  'utf8',
);
/** SQL without comments, so header notes do not count as statements. */
const ddl = migration
  .split('\n')
  .filter((line) => !line.trim().startsWith('--'))
  .join('\n');

describe('fix_legacy_honors_club_type migration (20261014100000)', () => {
  it('is transaction-agnostic and has no CONCURRENTLY', () => {
    expect(ddl).not.toMatch(/CONCURRENTLY/i);
    // PL/pgSQL `BEGIN` inside DO blocks is fine; only statement-level control is banned.
    expect(ddl).not.toMatch(
      /^\s*(BEGIN|COMMIT|ROLLBACK|START TRANSACTION)\s*;/im,
    );
    expect(ddl).not.toMatch(/DROP (TABLE|COLUMN|INDEX|TYPE)/i);
  });

  it('only targets LEGACY- honors and never the Adventurer import', () => {
    expect(ddl).toContain("code LIKE 'LEGACY-%'");
    expect(ddl).not.toMatch(/ADV-/);
    expect(ddl).not.toMatch(/club_type_id\s*=\s*1\b/);
  });

  it('special-cases LEGACY-649 with a name guard and skips it on mismatch', () => {
    expect(ddl).toContain("code = 'LEGACY-649'");
    expect(ddl).toContain("lower(btrim(name)) = 'bioseguridad'");
    expect(ddl).toContain('t.target_club_type_id IS NOT NULL');
  });

  it('updates honors only where the club type differs', () => {
    expect(ddl).toMatch(
      /h\.club_type_id IS DISTINCT FROM t\.target_club_type_id/,
    );
  });

  it('upserts the target row, then deletes the other rows', () => {
    expect(ddl).toMatch(
      /ON CONFLICT \(honor_id, club_type_id\) DO UPDATE\s+SET active = true,\s+modified_at = now\(\)/,
    );
    expect(ddl).toMatch(
      /DELETE FROM honor_club_types AS hct[\s\S]*hct\.club_type_id <> t\.target_club_type_id/,
    );
    expect(ddl.indexOf('INSERT INTO honor_club_types')).toBeLessThan(
      ddl.indexOf('DELETE FROM honor_club_types'),
    );
  });

  it('ends with a sanity check that raises on inconsistencies', () => {
    const sanity = ddl.slice(ddl.lastIndexOf('DO $$'));
    expect(sanity).toMatch(/RAISE EXCEPTION/);
    expect(sanity).toContain('honor_club_types');
  });
});
