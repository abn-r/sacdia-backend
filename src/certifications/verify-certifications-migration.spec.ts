import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  CERTIFICATIONS_MIGRATION_CHECKS,
  CERTIFICATIONS_MIGRATION_VERIFY_DATABASE_URL,
  isNeonUrl,
  listCertificationMigrationCheckNames,
} from '../../scripts/verify-certifications-migration';


describe('verify-certifications-migration', () => {
  it('exports integrity checks for backfill anomalies', () => {
    expect(listCertificationMigrationCheckNames()).toEqual(
      expect.arrayContaining([
        'Every enrollment has a certification version',
        'Every certification has a published version 1 after backfill',
        'Every module is bound to a version',
        'No orphan section progress without matching enrollment when enrollment_id is set',
        'No certification evidence without owning response',
        'Published versions cannot keep draft-only status drift',
      ]),
    );
  });

  it('checks abort on null version and orphan evidence', () => {
    const names = CERTIFICATIONS_MIGRATION_CHECKS.map((c) => c.name);
    expect(names.join(' ')).toMatch(/enrollment has a certification version/i);
    expect(names.join(' ')).toMatch(/evidence without owning response/i);

    const evidenceCheck = CERTIFICATIONS_MIGRATION_CHECKS.find((c) =>
      /evidence without owning response/i.test(c.name),
    );
    expect(evidenceCheck?.sql).toMatch(/certification_evidences/i);
    expect(evidenceCheck?.sql).toMatch(/LEFT JOIN certification_component_responses/i);
  });

  it('refuses Neon hosts without explicit opt-in helper', () => {
    expect(isNeonUrl('postgres://ep-x.us-east-1.aws.neon.tech/neondb')).toBe(
      true,
    );
    expect(isNeonUrl('postgres://localhost:5432/sacdia')).toBe(false);
  });

  it('keeps the verify script read-only and explicit-URL only', () => {
    const source = readFileSync(
      join(process.cwd(), 'scripts/verify-certifications-migration.ts'),
      'utf8',
    );

    expect(source).toMatch(
      new RegExp(CERTIFICATIONS_MIGRATION_VERIFY_DATABASE_URL),
    );
    expect(source).toMatch(/BEGIN READ ONLY/);
    expect(source).toMatch(/--dry-run/);
    expect(source).toMatch(/ALLOW_NEON_CERTIFICATIONS_VERIFY/);
    expect(source).not.toMatch(
      /connectionString:\s*process\.env\.DATABASE_URL/,
    );
  });
});
