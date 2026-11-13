import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Prisma } from '@prisma/client';

const MIGRATIONS = join(__dirname, '../../prisma/migrations');
const read = (name: string): string =>
  readFileSync(join(MIGRATIONS, name, 'migration.sql'), 'utf8');

const COLUMNS = read('20261113100000_family_majority_release_columns');
const LEGAL = read('20261113110000_family_majority_release_legal');
const LINK_CODES = read('20261113120000_family_majority_release_link_codes');
const BACKFILL = read(
  '20261113140000_family_majority_release_backfill_profiles',
);
const schema = readFileSync(
  join(__dirname, '../../prisma/schema.prisma'),
  'utf8',
);

const stripComments = (sql: string): string =>
  sql
    .split('\n')
    .filter((line) => !line.trim().startsWith('--'))
    .join('\n');

const statements = (sql: string): string[] =>
  stripComments(sql)
    .split(';')
    .map((part) => part.trim())
    .filter((part) => part.length > 0);

describe('Phase 4 migration 20261113100000 (release columns)', () => {
  const ddl = stripComments(COLUMNS);

  it('adds the 8 columns idempotently, with no DML', () => {
    for (const column of [
      'majority_notice_sent_at timestamptz\\(6\\)',
      'released_at timestamptz\\(6\\)',
      'release_deadline_at timestamptz\\(6\\)',
      'release_source varchar\\(16\\)',
      'release_accepted_at timestamptz\\(6\\)',
      'release_completed_at timestamptz\\(6\\)',
      'release_reminder_level smallint NOT NULL DEFAULT 0',
      'frozen_reason varchar\\(24\\)',
    ]) {
      expect(ddl).toMatch(
        new RegExp(`ADD COLUMN IF NOT EXISTS ${column}(;|\\s)`),
      );
    }
    expect(ddl).not.toMatch(/\b(INSERT|UPDATE|DELETE|TRUNCATE)\b/i);
    expect(ddl).not.toMatch(/\bDROP TABLE\b/i);
  });

  it('declares the 5 CHECKs via DROP IF EXISTS + ADD (re-runnable)', () => {
    for (const name of [
      'release_pair_ck',
      'release_completed_ck',
      'release_source_ck',
      'release_reminder_ck',
      'frozen_reason_ck',
    ]) {
      expect(ddl).toMatch(
        new RegExp(
          `DROP CONSTRAINT IF EXISTS dependent_profiles_${name};\\s+ALTER TABLE dependent_profiles ADD CONSTRAINT dependent_profiles_${name}`,
        ),
      );
    }
    expect(ddl).toMatch(
      /\(released_at IS NULL\) = \(release_deadline_at IS NULL\)/,
    );
    // R2: two reminders (levels 1 and 2).
    expect(ddl).toMatch(/release_reminder_level BETWEEN 0 AND 2/);
    expect(ddl).toMatch(/frozen_reason IN \('majority_release'\)/);
    expect(ddl).toMatch(/release_source IN \('cron', 'catchup'\)/);
  });

  it('creates the two partial indexes', () => {
    expect(ddl).toMatch(
      /CREATE INDEX IF NOT EXISTS idx_dependent_profiles_unreleased\s+ON dependent_profiles \(user_id\)\s+WHERE released_at IS NULL AND frozen_at IS NULL AND purged_at IS NULL/,
    );
    expect(ddl).toMatch(
      /CREATE INDEX IF NOT EXISTS idx_dependent_profiles_release_deadline\s+ON dependent_profiles \(release_deadline_at\)\s+WHERE released_at IS NOT NULL AND release_completed_at IS NULL AND frozen_at IS NULL AND purged_at IS NULL/,
    );
  });

  it('never schedules a purge for a majority freeze (R6)', () => {
    expect(COLUMNS).toMatch(/NEVER sets purge_after/);
    // No DML touches purge_after; only the pair CHECK mentions it.
    expect(ddl).not.toMatch(/UPDATE\s+dependent_profiles/i);
  });

  it('relaxes the Phase 2 frozen pair CHECK by reason (R6)', () => {
    expect(ddl).toMatch(
      /DROP CONSTRAINT IF EXISTS dependent_profiles_frozen_ck/,
    );
    // Legacy freeze keeps requiring a purge date.
    expect(ddl).toMatch(
      /frozen_at IS NOT NULL AND frozen_reason IS NULL AND purge_after IS NOT NULL/,
    );
    // A majority-release freeze must NOT carry a purge date.
    expect(ddl).toMatch(
      /frozen_at IS NOT NULL AND frozen_reason IS NOT NULL AND frozen_reason = 'majority_release' AND purge_after IS NULL/,
    );
  });

  it('the Prisma model carries the 8 fields', () => {
    const model = Prisma.dmmf.datamodel.models.find(
      (m) => m.name === 'dependent_profiles',
    );
    expect(model?.fields.map((f) => f.name)).toEqual(
      expect.arrayContaining([
        'majority_notice_sent_at',
        'released_at',
        'release_deadline_at',
        'release_source',
        'release_accepted_at',
        'release_completed_at',
        'release_reminder_level',
        'frozen_reason',
      ]),
    );
    expect(schema).toMatch(/idx_dependent_profiles_unreleased/);
  });
});

describe('Phase 4 migration 20261113110000 (legal acceptances)', () => {
  const ddl = stripComments(LEGAL);

  it('widens the method CHECK with majority_release', () => {
    expect(ddl).toMatch(
      /DROP CONSTRAINT IF EXISTS legal_acceptances_method_ck;\s+ALTER TABLE legal_acceptances ADD CONSTRAINT legal_acceptances_method_ck\s+CHECK \(method IN \('register_checkbox', 'acceptance_gate', 'majority_release'\)\)/,
    );
  });

  it('swaps the unique index for two partial ones (old name kept)', () => {
    expect(ddl).toMatch(
      /DROP INDEX IF EXISTS uq_legal_acceptances_user_doc_version;/,
    );
    expect(ddl).toMatch(
      /CREATE UNIQUE INDEX IF NOT EXISTS uq_legal_acceptances_user_doc_version\s+ON legal_acceptances \(user_id, document_type, document_version\)\s+WHERE method <> 'majority_release'/,
    );
    expect(ddl).toMatch(
      /CREATE UNIQUE INDEX IF NOT EXISTS uq_legal_acceptances_release_user_doc_version\s+ON legal_acceptances \(user_id, document_type, document_version\)\s+WHERE method = 'majority_release'/,
    );
    expect(statements(LEGAL)).toHaveLength(5);
    expect(ddl).not.toMatch(/\b(INSERT|UPDATE|DELETE|TRUNCATE)\b/i);
  });

  it('the Prisma model no longer declares @@unique', () => {
    const body = /model legal_acceptances \{[\s\S]*?\n\}/.exec(schema)?.[0];
    expect(body).not.toMatch(/@@unique/);
  });
});

describe('Phase 4 migration 20261113120000 (adult_claim link codes)', () => {
  const ddl = stripComments(LINK_CODES);

  it('adds adult_claim to the purpose CHECK, keeping the previous values', () => {
    expect(ddl).toMatch(
      /CHECK \(purpose IN \('second_guardian', 'director_claim', 'teen_guardian_link', 'adult_claim'\)\)/,
    );
  });

  it('adds the adult_claim consumer CHECK and changes no nullability', () => {
    expect(ddl).toMatch(
      /guardianship_link_codes_adult_claim_ck\s+CHECK \(purpose <> 'adult_claim' OR consumed_by_user_id IS NULL OR consumed_by_user_id = dependent_user_id\)/,
    );
    expect(ddl).not.toMatch(/DROP NOT NULL|SET NOT NULL/i);
    expect(ddl).not.toMatch(/\b(INSERT|UPDATE|DELETE|TRUNCATE)\b/i);
  });
});

describe('Phase 4 migration 20261113140000 (backfill dependent profiles)', () => {
  const ddl = stripComments(BACKFILL);

  it('only inserts missing profile rows (ON CONFLICT DO NOTHING)', () => {
    expect(statements(BACKFILL)).toHaveLength(1);
    expect(ddl.trim()).toMatch(
      /^INSERT INTO dependent_profiles \(user_id, created_by_user_id, created_at\)/,
    );
    expect(ddl).toMatch(
      /SELECT dependent_user_id AS uid FROM guardianships\s+UNION\s+SELECT user_id AS uid FROM supervised_logins/,
    );
    expect(ddl).toMatch(/ON CONFLICT \(user_id\) DO NOTHING/);
  });

  it('touches no release column (the backfill is the cron catch-up)', () => {
    expect(ddl).not.toMatch(
      /released_at|release_deadline_at|release_source|frozen_at|purge_after/,
    );
  });

  it('ships a commented verification query', () => {
    expect(BACKFILL).toMatch(/-- Verification \(expect 0 rows\)/);
  });
});
