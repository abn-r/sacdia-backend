/**
 * Single reader of the permission catalog sources. Pure fs/path: no Nest, no
 * Prisma. Shared by the parity spec and the authz catalog generator.
 *
 * The capability catalog (`loadCapabilityCatalog`) is the one exception: its
 * source is TypeScript (`src/common/authorization/capabilities.ts`), so it is
 * imported rather than parsed.
 *
 * Sources (later definitions win; the seed is the current state, so it is read
 * last):
 *  - every `INSERT INTO permissions ... ;` in prisma/migrations/** /migration.sql
 *    (chronological by directory name)
 *  - prisma/seeds/permissions.seed.sql
 *
 * Within each source, `UPDATE permissions SET active = false ... WHERE
 * permission_name IN (...)` statements retire keys after the inserts, so a
 * key the seed inserts and then retires ends up inactive, as it is in the DB.
 */
import * as fs from 'fs';
import * as path from 'path';
import { CAPABILITY_DEFINITIONS } from '../../src/common/authorization/capabilities';

export type CatalogPermission = {
  key: string;
  description: string;
  active: boolean;
  /** Repo-relative path (posix separators) of the file that defined it last. */
  source: string;
};

const TUPLE_RE =
  /\(\s*'([a-z_-]+:[a-z_-]+)'\s*,\s*'((?:[^']|'')*)'\s*,\s*(true|false)\s*\)/gi;
const RETIRE_RE =
  /UPDATE\s+"?permissions"?\s+SET\s+active\s*=\s*false\b[^;]*?WHERE\s+permission_name\s+IN\s*\(([^)]*)\)/gi;
const KEY_RE = /'([a-z_-]+:[a-z_-]+)'/g;

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of fs
    .readdirSync(dir, { withFileTypes: true })
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))) {
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

function rel(root: string, file: string): string {
  return path.relative(root, file).split(path.sep).join('/');
}

export function loadPermissionCatalog(root: string): CatalogPermission[] {
  const byKey = new Map<string, CatalogPermission>();
  const add = (sql: string, source: string) => {
    for (const m of sql.matchAll(TUPLE_RE)) {
      byKey.set(m[1], {
        key: m[1],
        description: m[2].replace(/''/g, "'"),
        active: m[3].toLowerCase() === 'true',
        source,
      });
    }
  };
  const retire = (sql: string, source: string) => {
    for (const stmt of sql.matchAll(RETIRE_RE)) {
      for (const k of stmt[1].matchAll(KEY_RE)) {
        const existing = byKey.get(k[1]);
        if (existing) byKey.set(k[1], { ...existing, active: false, source });
      }
    }
  };

  const migrationsDir = path.join(root, 'prisma/migrations');
  for (const file of walk(migrationsDir).filter((f) =>
    f.endsWith('migration.sql'),
  )) {
    const sql = fs.readFileSync(file, 'utf8');
    for (const stmt of sql.matchAll(
      /INSERT\s+INTO\s+"?permissions"?\b[^;]*;/gi,
    )) {
      add(stmt[0], rel(root, file));
    }
    retire(sql, rel(root, file));
  }

  const seedFile = path.join(root, 'prisma/seeds/permissions.seed.sql');
  const seedSql = fs.readFileSync(seedFile, 'utf8');
  add(seedSql, rel(root, seedFile));
  retire(seedSql, rel(root, seedFile));

  return [...byKey.values()].sort((a, b) =>
    a.key < b.key ? -1 : a.key > b.key ? 1 : 0,
  );
}

/** `<area>.<action>[.<qualifier>]`, lower snake-case segments. */
export const CAPABILITY_KEY_RE = /^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/;

/**
 * Sorted (byte order) capability keys, the keys of `CAPABILITY_DEFINITIONS`.
 * Throws on a malformed key so a typo never reaches the three repos.
 */
export function loadCapabilityCatalog(
  definitions: Record<string, unknown> = CAPABILITY_DEFINITIONS,
): string[] {
  const keys = Object.keys(definitions);
  const invalid = keys.filter((key) => !CAPABILITY_KEY_RE.test(key));
  if (invalid.length) {
    throw new Error(`Malformed capability key(s): ${invalid.join(', ')}`);
  }
  return [...keys].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}
