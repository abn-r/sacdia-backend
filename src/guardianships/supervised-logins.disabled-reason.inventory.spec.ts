import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Verify W5 (FP3-16): `supervised_logins.disabled_reason` is limited by a CHECK
 * in the 3a migration ('guardian', 'admin', 'unlinked_purged'). FP3-16 wants
 * 'age_majority' recorded at the age of majority, but the CHECK does not allow
 * it yet: the widening is bundled with the 3b migration (user approval). Until
 * then NO code path may write a value the CHECK rejects (it would throw at
 * runtime, inside a transaction). This inventory scans every source file for
 * `disabled_reason: '<literal>'` and fails on any value outside the CHECK.
 *
 * When the CHECK is widened (drop + add of
 * supervised_logins_disabled_reason_ck), this spec follows it automatically:
 * it reads the allowed list from the latest migration that defines it.
 */
const ROOT = join(__dirname, '..');
const MIGRATIONS = join(__dirname, '../../prisma/migrations');

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) walk(path, out);
    else if (
      path.endsWith('.ts') &&
      !path.endsWith('.spec.ts') &&
      !path.endsWith('.testing.ts')
    ) {
      out.push(path);
    }
  }
  return out;
}

/** Allowed values of the LAST migration that (re)defines the CHECK. */
function allowedByCheck(): string[] {
  const pattern =
    /supervised_logins_disabled_reason_ck\s+CHECK\s*\(\s*disabled_reason IS NULL OR disabled_reason IN \(([^)]*)\)\s*\)/g;
  let allowed: string[] | null = null;
  for (const dir of readdirSync(MIGRATIONS).sort()) {
    const file = join(MIGRATIONS, dir, 'migration.sql');
    let sql: string;
    try {
      sql = readFileSync(file, 'utf8');
    } catch {
      continue;
    }
    for (const match of sql.matchAll(pattern)) {
      allowed = [...match[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
    }
  }
  if (!allowed)
    throw new Error('supervised_logins_disabled_reason_ck not found');
  return allowed;
}

function writtenReasons(): Array<{ file: string; value: string }> {
  const found: Array<{ file: string; value: string }> = [];
  for (const file of walk(ROOT)) {
    const source = readFileSync(file, 'utf8');
    for (const match of source.matchAll(/disabled_reason:\s*'([^']+)'/g)) {
      found.push({ file: file.slice(ROOT.length + 1), value: match[1] });
    }
  }
  return found;
}

describe('supervised_logins.disabled_reason writes stay inside the DB CHECK', () => {
  it('the CHECK is found and today does NOT allow age_majority (bundled with 3b)', () => {
    const allowed = allowedByCheck();
    expect(allowed).toEqual(
      expect.arrayContaining(['guardian', 'admin', 'unlinked_purged']),
    );
    // Flip this expectation when the 3b migration widens the CHECK.
    expect(allowed).not.toContain('age_majority');
  });

  it('the scanner sees the known writers (sanity: guardian disable, cron freeze)', () => {
    const values = writtenReasons().map((w) => w.value);
    expect(values).toEqual(
      expect.arrayContaining(['guardian', 'unlinked_purged']),
    );
  });

  it('every disabled_reason literal written by the code is allowed by the CHECK (no age_majority write before the migration)', () => {
    const allowed = new Set(allowedByCheck());
    const offenders = writtenReasons().filter((w) => !allowed.has(w.value));
    expect(offenders).toEqual([]);
  });
});
