import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Prisma } from '@prisma/client';

const MIGRATIONS = join(__dirname, '../../prisma/migrations');
const DROP_MIGRATION = '20261114100000_family_drop_legal_representatives';
const sql = readFileSync(
  join(MIGRATIONS, DROP_MIGRATION, 'migration.sql'),
  'utf8',
);

const stripComments = (text: string): string =>
  text
    .split('\n')
    .filter((line) => !line.trim().startsWith('--'))
    .join('\n');

const statements = (text: string): string[] =>
  stripComments(text)
    .split(';')
    .map((part) => part.trim())
    .filter((part) => part.length > 0);

describe('family drop legal_representatives migration (Phase 4c-2, FP4-53)', () => {
  it('is exactly one re-runnable DROP TABLE IF EXISTS', () => {
    expect(statements(sql)).toEqual([
      'DROP TABLE IF EXISTS legal_representatives',
    ]);
  });

  it('documents the mandatory pg_dump backup and the restore rollback', () => {
    expect(sql).toMatch(/pg_dump[\s\S]*-t legal_representatives/);
    expect(sql).toMatch(/Rollback = restore that dump/);
  });

  it('is the only migration allowed to drop the table (exemption scoped to 4c-2)', () => {
    const offenders = readdirSync(MIGRATIONS, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && entry.name > '20261016120000')
      .filter((entry) => entry.name !== DROP_MIGRATION)
      .filter((entry) =>
        /DROP\s+TABLE\s+(IF\s+EXISTS\s+)?legal_representatives\b/i.test(
          stripComments(
            readFileSync(join(MIGRATIONS, entry.name, 'migration.sql'), 'utf8'),
          ),
        ),
      )
      .map((entry) => entry.name);
    expect(offenders).toEqual([]);
  });

  it('removes the legal_representatives model from the Prisma schema', () => {
    const modelNames = Prisma.dmmf.datamodel.models.map((m) => m.name);
    expect(modelNames).not.toContain('legal_representatives');
    const schema = readFileSync(
      join(__dirname, '../../prisma/schema.prisma'),
      'utf8',
    );
    expect(schema).not.toMatch(/legal_representatives/);
  });
});
