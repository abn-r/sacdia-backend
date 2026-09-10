import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const migration = readFileSync(
  join(
    __dirname,
    '../../prisma/migrations/20260909130000_director_succession_open_unique/migration.sql',
  ),
  'utf8',
);

describe('director succession open unique (20260909130000)', () => {
  it('drops the full section/year unique', () => {
    expect(migration).toMatch(
      /DROP CONSTRAINT IF EXISTS director_succession_plans_section_year_key/,
    );
  });

  it('creates a partial unique for open plans only', () => {
    expect(migration).toMatch(
      /CREATE UNIQUE INDEX uniq_director_succession_open_section_year/,
    );
    expect(migration).toMatch(
      /WHERE status IN \('scheduled', 'activated', 'blocked'\)/,
    );
  });
});
