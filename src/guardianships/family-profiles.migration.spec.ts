import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Prisma } from '@prisma/client';

const migration = readFileSync(
  join(
    __dirname,
    '../../prisma/migrations/20261016120000_family_profiles/migration.sql',
  ),
  'utf8',
);

const schema = readFileSync(
  join(__dirname, '../../prisma/schema.prisma'),
  'utf8',
);

/** El SQL sin comentarios: así los avisos del encabezado no cuentan como DDL. */
const stripComments = (sql: string): string =>
  sql
    .split('\n')
    .filter((line) => !line.trim().startsWith('--'))
    .join('\n');

const splitStatements = (sql: string): string[] =>
  stripComments(sql)
    .split(';')
    .map((part) => part.trim())
    .filter((part) => part.length > 0);

const INDEX_NAMES = [
  'idx_dependent_profiles_purge',
  'uq_guardianships_active_pair',
  'uq_guardianships_active_primary',
  'uq_guardianships_active_custodian',
  'idx_guardianships_dependent',
  'idx_guardianships_guardian_active',
  'idx_guardianships_custodian_club',
  'uq_guardianship_consent_evidences_current',
  'idx_guardianship_link_codes_dependent_open',
];

const ALLOWED_STATEMENTS: RegExp[] = [
  /^ALTER TABLE users ALTER COLUMN email DROP NOT NULL$/,
  /^ALTER TABLE countries ADD COLUMN IF NOT EXISTS minor_self_login_min_age smallint NOT NULL DEFAULT 13\s+CONSTRAINT countries_minor_self_login_min_age_ck CHECK/,
  /^ALTER TABLE countries ADD COLUMN IF NOT EXISTS age_of_majority smallint NOT NULL DEFAULT 18\s+CONSTRAINT countries_age_of_majority_ck CHECK/,
  /^ALTER TABLE countries ADD COLUMN IF NOT EXISTS age_reference_timezone varchar\(64\)$/,
  /^CREATE TABLE IF NOT EXISTS (dependent_profiles|guardianships|guardianship_consent_evidences|guardianship_link_codes) \(/,
  new RegExp(
    `^CREATE (UNIQUE )?INDEX IF NOT EXISTS (${INDEX_NAMES.join('|')})\\s+ON `,
  ),
];

const DENIED_PATTERNS: RegExp[] = [
  /\bDROP\s+(TABLE|COLUMN|INDEX|CONSTRAINT|SCHEMA|TYPE|VIEW|DEFAULT|FUNCTION|TRIGGER)\b/i,
  /\bSET\s+NOT\s+NULL\b/i,
  /\bRENAME\b/i,
  /\bALTER\s+COLUMN\s+(?!email DROP NOT NULL)/i,
  /\bTRUNCATE\b/i,
  /\bDELETE\b/i,
  /\bUPDATE\s+\w+\s+SET\b/i,
  /\bINSERT\b/i,
  /\bCONCURRENTLY\b/i,
  /^\s*(BEGIN|COMMIT)\s*;/im,
  /\bON\s+(DELETE|UPDATE)\b/i,
];

/**
 * Guard de la migración: solo DDL aditivo, con UNA excepción explícita
 * (users.email pasa a nullable). Devuelve las violaciones encontradas;
 * vacío = migración segura.
 */
function findViolations(sql: string): string[] {
  const ddl = stripComments(sql);
  const violations: string[] = [];

  for (const statement of splitStatements(sql)) {
    if (!ALLOWED_STATEMENTS.some((allowed) => allowed.test(statement))) {
      violations.push(`not allowlisted: ${statement.slice(0, 60)}`);
    }
  }
  for (const denied of DENIED_PATTERNS) {
    if (denied.test(ddl)) {
      violations.push(`denied: ${denied.source}`);
    }
  }
  return violations;
}

describe('family profiles migration (20261016120000)', () => {
  const ddl = stripComments(migration);
  const statements = splitStatements(migration);

  it('passes the allowlist/denylist guard', () => {
    expect(findViolations(migration)).toEqual([]);
  });

  it('contains exactly 17 statements: 4 ALTER, 4 CREATE TABLE and 9 indexes (4 unique + 5 non-unique)', () => {
    // El diseño decía 21; el SQL real tiene 17 (ruling A1/C6).
    expect(statements).toHaveLength(17);
    expect(statements.filter((s) => s.startsWith('ALTER TABLE'))).toHaveLength(
      4,
    );
    expect(statements.filter((s) => s.startsWith('CREATE TABLE'))).toHaveLength(
      4,
    );
    const indexes = statements.filter((s) => /^CREATE (UNIQUE )?INDEX/.test(s));
    expect(indexes).toHaveLength(9);
    expect(indexes.filter((s) => s.startsWith('CREATE UNIQUE'))).toHaveLength(
      4,
    );
    expect(indexes.filter((s) => !s.startsWith('CREATE UNIQUE'))).toHaveLength(
      5,
    );
  });

  it('declares all nine index names', () => {
    for (const name of INDEX_NAMES) {
      expect(ddl).toMatch(
        new RegExp(`CREATE (UNIQUE )?INDEX IF NOT EXISTS ${name}\\b`),
      );
    }
  });

  it('is re-runnable: every create and column add carries IF NOT EXISTS', () => {
    for (const statement of statements) {
      if (/^ALTER TABLE users /.test(statement)) continue;
      expect(statement).toMatch(
        /^(CREATE TABLE IF NOT EXISTS|CREATE (UNIQUE )?INDEX IF NOT EXISTS|ALTER TABLE countries ADD COLUMN IF NOT EXISTS)\b/,
      );
    }
  });

  it('makes users.email nullable and nothing else on users', () => {
    const userAlters = statements.filter((s) => /^ALTER TABLE users\b/.test(s));
    expect(userAlters).toEqual([
      'ALTER TABLE users ALTER COLUMN email DROP NOT NULL',
    ]);
    expect(ddl).not.toMatch(/DROP\s+NOT\s+NULL[\s\S]*DROP\s+NOT\s+NULL/i);
  });

  describe('guard negative cases', () => {
    it.each([
      [
        'DROP NOT NULL on another column',
        'ALTER TABLE users ALTER COLUMN name DROP NOT NULL;',
      ],
      [
        'SET NOT NULL on email',
        'ALTER TABLE users ALTER COLUMN email SET NOT NULL;',
      ],
      ['ADD COLUMN on users', 'ALTER TABLE users ADD COLUMN x int;'],
      [
        'DROP COLUMN on countries',
        'ALTER TABLE countries DROP COLUMN age_of_majority;',
      ],
      ['DROP TABLE', 'DROP TABLE legal_representatives;'],
      [
        'INSERT',
        'INSERT INTO guardianships (dependent_user_id) VALUES (NULL);',
      ],
      ['UPDATE ... SET', 'UPDATE users SET email = NULL;'],
      ['TRUNCATE', 'TRUNCATE guardianships;'],
      ['BEGIN', 'BEGIN;'],
      ['COMMIT', 'COMMIT;'],
      [
        'CONCURRENTLY',
        'CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_guardianships_dependent ON guardianships (dependent_user_id);',
      ],
      ['an unrelated table', 'CREATE TABLE IF NOT EXISTS other (id int);'],
    ])('fails when an extra %s statement is appended', (_label, extra) => {
      expect(findViolations(`${migration}\n${extra}\n`)).not.toEqual([]);
    });

    it('ignores forbidden words that only appear inside -- comments', () => {
      expect(
        findViolations(`-- DROP TABLE x; ALTER TABLE y;\n${migration}`),
      ).toEqual([]);
    });
  });

  it('declares the three countries age-policy columns with defaults and CHECKs', () => {
    expect(ddl).toMatch(
      /minor_self_login_min_age smallint NOT NULL DEFAULT 13\s+CONSTRAINT countries_minor_self_login_min_age_ck CHECK \(minor_self_login_min_age BETWEEN 0 AND 21\)/,
    );
    expect(ddl).toMatch(
      /age_of_majority smallint NOT NULL DEFAULT 18\s+CONSTRAINT countries_age_of_majority_ck CHECK \(age_of_majority BETWEEN 14 AND 21\)/,
    );
    expect(ddl).toMatch(/age_reference_timezone varchar\(64\)/);
  });

  it('keeps FKs on the default NO ACTION (no ON DELETE / ON UPDATE clauses)', () => {
    expect(ddl).not.toMatch(/\bON\s+(DELETE|UPDATE)\b/i);
  });

  it('declares the guardianships CHECK constraints', () => {
    for (const check of [
      'guardianships_consent_status_ck',
      'guardianships_verification_method_ck',
      'guardianships_revoked_reason_ck',
      'guardianships_holder_ck',
      'guardianships_not_self_ck',
      'guardianships_revoked_ck',
      'guardianships_verified_ck',
    ]) {
      expect(ddl).toMatch(new RegExp(`CONSTRAINT ${check} CHECK`));
    }
  });

  it('documents that Render migrates at the end of the build (no preDeploy)', () => {
    expect(migration).toMatch(/END OF THE BUILD/);
    expect(migration).toMatch(/no preDeploy/i);
  });

  it('matches the Prisma schema (models, fields, optional email, back-relations)', () => {
    const { models } = Prisma.dmmf.datamodel;
    const fieldNames = (name: string): string[] | undefined =>
      models.find((entry) => entry.name === name)?.fields.map((f) => f.name);

    expect(fieldNames('dependent_profiles')).toEqual(
      expect.arrayContaining([
        'user_id',
        'created_by_user_id',
        'created_at',
        'frozen_at',
        'purge_after',
        'purged_at',
        'user',
        'created_by',
      ]),
    );
    expect(fieldNames('guardianships')).toEqual(
      expect.arrayContaining([
        'guardianship_id',
        'dependent_user_id',
        'guardian_user_id',
        'is_custodian',
        'custodian_club_id',
        'relationship_type_id',
        'is_primary',
        'consent_status',
        'sworn_declaration_at',
        'invited_by_guardianship_id',
        'verified_by_user_id',
        'verification_method',
        'verified_at',
        'revoked_at',
        'revoked_reason',
        'external_name',
        'external_phone',
        'is_test_data',
        'created_at',
        'modified_at',
      ]),
    );
    expect(fieldNames('guardianship_consent_evidences')).toEqual(
      expect.arrayContaining([
        'evidence_id',
        'guardianship_id',
        'file_key',
        'content_type',
        'size_bytes',
        'uploaded_by_user_id',
        'uploaded_at',
        'superseded_at',
        'purged_at',
      ]),
    );
    expect(fieldNames('guardianship_link_codes')).toEqual(
      expect.arrayContaining([
        'link_code_id',
        'code_hash',
        'dependent_user_id',
        'purpose',
        'issued_by_user_id',
        'issued_for_club_section_id',
        'expires_at',
        'consumed_at',
        'consumed_by_user_id',
        'revoked_at',
        'created_at',
      ]),
    );
    expect(fieldNames('countries')).toEqual(
      expect.arrayContaining([
        'minor_self_login_min_age',
        'age_of_majority',
        'age_reference_timezone',
      ]),
    );

    // El DMMF de runtime no expone isRequired: se verifica en el schema.
    expect(schema).toMatch(
      /model users \{[\s\S]*?\n\s+email\s+String\?\s+@unique @db\.VarChar\(100\)/,
    );

    expect(fieldNames('users')).toEqual(
      expect.arrayContaining([
        'dependent_profile',
        'guardianships_as_dependent',
        'guardianships_as_guardian',
      ]),
    );
    expect(fieldNames('clubs')).toContain('guardianships_custodian');
    expect(fieldNames('relationship_types')).toContain('guardianships');
    expect(fieldNames('club_sections')).toContain('guardianship_link_codes');
  });

  it('documents the SQL-only partial indexes next to the models and maps the plain index', () => {
    expect(schema).toMatch(
      /model guardianships \{[\s\S]*?@@index\(\[dependent_user_id\], map: "idx_guardianships_dependent"\)[\s\S]*?\}/,
    );
    for (const name of INDEX_NAMES.filter(
      (n) => n !== 'idx_guardianships_dependent',
    )) {
      expect(schema).toContain(name);
    }
    expect(schema).toContain('20261016120000_family_profiles');
  });
});
