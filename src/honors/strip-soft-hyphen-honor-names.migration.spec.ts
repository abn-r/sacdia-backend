import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const MIGRATION_NAME = '20261028130300_strip_soft_hyphen_from_honor_names';
const SOFT_HYPHEN = String.fromCharCode(0xad);

const migration = readFileSync(
  join(__dirname, '../../prisma/migrations', MIGRATION_NAME, 'migration.sql'),
  'utf8',
);
const ddl = migration
  .split('\n')
  .filter((line) => !line.trim().startsWith('--'))
  .join('\n');

describe('strip soft hyphen from honor names migration (20261028130300)', () => {
  it('keeps the literal soft hyphen out of the file and uses chr(173)', () => {
    expect(migration).not.toContain(SOFT_HYPHEN);
    expect(ddl).toContain('chr(173)');
  });

  it('cleans honors.name and honors_translations.name only', () => {
    expect(ddl).toMatch(/UPDATE honors\s+SET name = replace\(name, chr\(173\)/);
    expect(ddl).toMatch(
      /UPDATE honors_translations\s+SET name = replace\(name, chr\(173\)/,
    );
    expect(ddl.match(/UPDATE /g)).toHaveLength(2);
  });

  it('is idempotent: every UPDATE is limited to rows that still contain U+00AD', () => {
    const updates = ddl.split('UPDATE ').slice(1);
    for (const update of updates) {
      expect(update).toContain('position(chr(173) in name) > 0');
    }
  });
});
