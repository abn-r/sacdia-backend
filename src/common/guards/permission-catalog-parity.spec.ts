/**
 * Parity check: every permission referenced in source code must exist in the
 * permission catalog (seed + migrations). A permission used in
 * @RequirePermissions() but missing in the DB is a "phantom": nobody can ever
 * hold it, so the route is silently unreachable (or the check never passes).
 *
 * Pure fs/path reads, no Nest bootstrap.
 *
 * Catalog sources:
 *  - prisma/seeds/permissions.seed.sql
 *  - every `INSERT INTO permissions` statement in prisma/migrations/** /migration.sql
 *    (some permissions only live in a migration, e.g. camporee_events).
 *
 * Usage sources (string literals 'x:y' / "x:y" inside the argument list of):
 *  @RequirePermissions(...), @SensitiveUserSubresource(...),
 *  permissions.includes(...), perms.includes(...), hasPermission(...),
 *  hasAnyPermission(...).
 * Additionally (to cover permissions passed through constants / policy tables):
 *  - `const FOO_PERMISSION[S] = 'x:y'` style constant declarations

 *  - any `= 'x:y'` inside files named permission(s).ts (constant modules)
 *  - `finePermission: 'x:y'` / `read: 'x:y'` style entries in
 *    src/common/guards/sensitive-user-subresource-policy.ts
 *
 * EXCLUDED literals (not permissions even though they look like 'x:y'):
 *  - sacdia:access, sacdia:device, sacdia:qr-member  (JWT token types / audiences)
 *  - auth:context and other cache keys (auth:*, cache:*)
 *  - acting-for scopes (self:read, ...) living in src/auth/acting-for/
 */
import * as fs from 'fs';
import * as path from 'path';

/** Must stay EMPTY. Add a permission here only as a short-lived, justified exception. */
const KNOWN_MISSING: string[] = [];

const ROOT = path.resolve(__dirname, '../../..');
const SRC = path.join(ROOT, 'src');

const EXCLUDED_LITERALS = new Set([
  'sacdia:access',
  'sacdia:device',
  'sacdia:qr-member',
  'auth:context',
]);
const EXCLUDED_PREFIXES = ['auth:', 'cache:', 'self:', 'sacdia:'];
const EXCLUDED_PATH_FRAGMENTS = [
  `${path.sep}auth${path.sep}acting-for${path.sep}`,
];

const PERM_RE = /^[a-z_-]+:[a-z_-]+$/;
const LITERAL_RE = /(['"])([a-z_-]+:[a-z_-]+)\1/g;

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'test' || entry.name === 'node_modules') continue;
      walk(full, out);
    } else {
      out.push(full);
    }
  }
  return out;
}

function loadCatalog(): Set<string> {
  const catalog = new Set<string>();
  const seed = fs.readFileSync(
    path.join(ROOT, 'prisma/seeds/permissions.seed.sql'),
    'utf8',
  );
  for (const m of seed.matchAll(/\('([a-z_-]+:[a-z_-]+)'/g)) catalog.add(m[1]);

  const migrationsDir = path.join(ROOT, 'prisma/migrations');
  for (const file of walk(migrationsDir).filter((f) =>
    f.endsWith('migration.sql'),
  )) {
    const sql = fs.readFileSync(file, 'utf8');
    // Each INSERT INTO permissions ... up to its terminating ';'
    for (const stmt of sql.matchAll(
      /INSERT\s+INTO\s+"?permissions"?\b[^;]*;/gi,
    )) {
      for (const m of stmt[0].matchAll(/\('([a-z_-]+:[a-z_-]+)'/g)) {
        catalog.add(m[1]);
      }
    }
  }
  return catalog;
}

/** Returns the text inside the balanced parens starting at `openIdx` (index of '('). */
function balancedArgs(
  text: string,
  openIdx: number,
): { body: string; end: number } {
  let depth = 0;
  for (let i = openIdx; i < text.length; i++) {
    const c = text[i];
    if (c === '(') depth++;
    else if (c === ')') {
      depth--;
      if (depth === 0) return { body: text.slice(openIdx + 1, i), end: i };
    }
  }
  return { body: text.slice(openIdx + 1), end: text.length };
}

const CALL_RE =
  /(@RequirePermissions|@SensitiveUserSubresource|\bpermissions\.includes|\bperms\.includes|\bhasPermission|\bhasAnyPermission)\s*\(/g;
const CONST_RE =
  /\b(?:const|readonly)\s+[A-Za-z0-9_]*PERMISSION[A-Za-z0-9_]*\s*(?::[^=]+)?=\s*(['"])([a-z_-]+:[a-z_-]+)\1/g;
const POLICY_FILE = path.join(
  'common',
  'guards',
  'sensitive-user-subresource-policy.ts',
);

type Usage = { permission: string; file: string; line: number };

function lineOf(text: string, idx: number): number {
  let n = 1;
  for (let i = 0; i < idx; i++) if (text.charCodeAt(i) === 10) n++;
  return n;
}

function isExcluded(p: string, file: string): boolean {
  if (EXCLUDED_LITERALS.has(p)) return true;
  if (EXCLUDED_PREFIXES.some((x) => p.startsWith(x))) return true;
  return EXCLUDED_PATH_FRAGMENTS.some((f) => file.includes(f));
}

function collectUsages(): Usage[] {
  const usages: Usage[] = [];
  const files = walk(SRC).filter(
    (f) => f.endsWith('.ts') && !f.endsWith('.spec.ts'),
  );
  for (const file of files) {
    const text = fs.readFileSync(file, 'utf8');
    const rel = path.relative(ROOT, file);
    const push = (perm: string, idx: number) => {
      if (!PERM_RE.test(perm) || isExcluded(perm, file)) return;
      usages.push({ permission: perm, file: rel, line: lineOf(text, idx) });
    };

    for (const call of text.matchAll(CALL_RE)) {
      const open = call.index + call[0].length - 1;
      const { body } = balancedArgs(text, open);
      for (const lit of body.matchAll(LITERAL_RE)) {
        push(lit[2], open + 1 + lit.index);
      }
    }
    for (const c of text.matchAll(CONST_RE)) push(c[2], c.index);

    // Dedicated permission-constant modules (e.g. camporee-orders/permissions.ts)
    if (/permissions?\.ts$/.test(path.basename(file))) {
      for (const c of text.matchAll(/=\s*(['"])([a-z_-]+:[a-z_-]+)\1/g)) {
        push(c[2], c.index);
      }
    }

    if (file.endsWith(POLICY_FILE)) {
      for (const lit of text.matchAll(LITERAL_RE)) {
        push(lit[2], lit.index);
      }
    }
  }
  return usages;
}

describe('permission catalog parity', () => {
  const catalog = loadCatalog();
  const usages = collectUsages();

  it('loads a non-trivial catalog and usage set (sanity)', () => {
    expect(catalog.size).toBeGreaterThan(100);
    expect(usages.length).toBeGreaterThan(100);
    expect(catalog.has('camporee_events:read')).toBe(true);
  });

  it('every permission used in src/ exists in the seed or a migration', () => {
    const missing = usages.filter(
      (u) =>
        !catalog.has(u.permission) && !KNOWN_MISSING.includes(u.permission),
    );
    const report = missing
      .map((u) => `  ${u.permission}  ->  ${u.file}:${u.line}`)
      .join('\n');
    if (missing.length > 0) {
      throw new Error(
        `Permissions used in code but absent from the catalog (${new Set(missing.map((m) => m.permission)).size}):\n${report}`,
      );
    }
  });

  it('KNOWN_MISSING stays empty', () => {
    expect(KNOWN_MISSING).toEqual([]);
  });
});
