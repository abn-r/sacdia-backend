import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  INSTITUTIONAL_HIERARCHY_CHECKS,
  isNeonUrl,
  listVerificationCheckNames,
} from '../../scripts/verify-institutional-hierarchy-migration';

describe('verify-institutional-hierarchy-migration', () => {
  it('exports the conservative foundation checks', () => {
    const names = listVerificationCheckNames();

    expect(names).toEqual(
      expect.arrayContaining([
        'Each entity has exactly one open effective relationship revision',
        'Each entity has exactly one open name version',
        'Current projection matches the revision covering CURRENT_DATE',
        'Current name projection matches the name version covering CURRENT_DATE',
        'Recorded relationship revisions have zero overlaps',
        'Recorded name versions have zero overlaps',
        'Reorganization participants never have ambiguous typed FKs',
        'hierarchy_contexts rows always have JSON context and precision',
        'Applied reorganizations always have participants',
        'Applied reorganizations always have audit linkage',
        'hierarchy_contexts.context never stores prohibited sensitive keys',
      ]),
    );
  });

  it('keeps open-revision checks scoped to recorded_to IS NULL', () => {
    const openChecks = INSTITUTIONAL_HIERARCHY_CHECKS.filter((check) =>
      /open effective|open name/i.test(check.name),
    );

    expect(openChecks.length).toBeGreaterThan(0);
    for (const check of openChecks) {
      expect(check.sql).toMatch(/recorded_to\s+IS\s+NULL/i);
    }
  });

  it('scopes overlap checks to currently recorded revisions', () => {
    const overlapChecks = INSTITUTIONAL_HIERARCHY_CHECKS.filter((check) =>
      /zero overlaps/i.test(check.name),
    );

    expect(overlapChecks.length).toBeGreaterThan(0);
    for (const check of overlapChecks) {
      expect(check.sql).toMatch(/recorded_to\s+IS\s+NULL/i);
    }
  });

  it('refuses Neon hosts without explicit opt-in helper', () => {
    expect(isNeonUrl('postgres://ep-x.us-east-1.aws.neon.tech/neondb')).toBe(
      true,
    );
    expect(isNeonUrl('postgres://localhost:5432/sacdia')).toBe(false);
  });

  it('keeps the verify script read-only and explicit-URL only', () => {
    const source = readFileSync(
      join(process.cwd(), 'scripts/verify-institutional-hierarchy-migration.ts'),
      'utf8',
    );

    expect(source).toMatch(/INSTITUTIONAL_HIERARCHY_VERIFY_DATABASE_URL/);
    expect(source).toMatch(/BEGIN READ ONLY/);
    expect(source).toMatch(/--dry-run/);
    expect(source).toMatch(/ALLOW_NEON_INSTITUTIONAL_VERIFY/);
    expect(source).not.toMatch(/connectionString:\s*process\.env\.DATABASE_URL/);
  });
});
