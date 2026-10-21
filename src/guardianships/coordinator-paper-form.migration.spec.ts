import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const MIGRATION = '20261024120000_allow_coordinator_paper_form';

const migration = readFileSync(
  join(__dirname, `../../prisma/migrations/${MIGRATION}/migration.sql`),
  'utf8',
);

/** SQL without comments: header notes do not count as DDL. */
const statements = migration
  .split('\n')
  .filter((line) => !line.trim().startsWith('--'))
  .join('\n')
  .split(';')
  .map((part) => part.trim())
  .filter((part) => part.length > 0);

describe('migration 20261024120000_allow_coordinator_paper_form', () => {
  it('is exactly a drop + add of guardianships_verification_method_ck', () => {
    expect(statements).toHaveLength(2);
    expect(statements[0]).toBe(
      'ALTER TABLE guardianships DROP CONSTRAINT IF EXISTS guardianships_verification_method_ck',
    );
    expect(statements[1]).toMatch(
      /^ALTER TABLE guardianships ADD CONSTRAINT guardianships_verification_method_ck\s+CHECK \(/,
    );
  });

  it('allows the five values: the four from family_profiles plus coordinator_paper_form', () => {
    const list = /verification_method IN \(([^)]*)\)/.exec(statements[1])?.[1];
    const values = (list ?? '')
      .split(',')
      .map((value) => value.trim().replace(/^'|'$/g, ''))
      .sort();

    expect(values).toEqual(
      [
        'director_paper_form',
        'coordinator_paper_form',
        'guardian_invite',
        'legacy_import',
        'test_placeholder',
      ].sort(),
    );
    expect(statements[1]).toMatch(/verification_method IS NULL OR/);
  });

  it('is a superset of the original CHECK in family_profiles', () => {
    const original = readFileSync(
      join(
        __dirname,
        '../../prisma/migrations/20261016120000_family_profiles/migration.sql',
      ),
      'utf8',
    );
    const originalList =
      /guardianships_verification_method_ck CHECK \([^()]*IN \(([^)]*)\)/.exec(
        original,
      )?.[1] ?? '';
    for (const value of originalList.split(',').map((v) => v.trim())) {
      expect(statements[1]).toContain(value);
    }
  });

  it('sorts after the latest earlier migration', () => {
    expect(
      MIGRATION > '20261023120000_grant_consent_verify_to_coordinators',
    ).toBe(true);
  });

  it('contains no other DDL or DML (no data touched)', () => {
    expect(statements.join(';')).not.toMatch(
      /\b(INSERT|UPDATE|DELETE|DROP TABLE|CREATE)\b/i,
    );
  });
});
