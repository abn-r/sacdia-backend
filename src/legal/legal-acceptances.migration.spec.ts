import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Prisma } from '@prisma/client';

const migration = readFileSync(
  join(
    __dirname,
    '../../prisma/migrations/20261015120000_legal_acceptances/migration.sql',
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

const ALLOWED_STATEMENTS: RegExp[] = [
  /^CREATE TABLE IF NOT EXISTS legal_acceptances \(/,
  /^CREATE UNIQUE INDEX IF NOT EXISTS uq_legal_acceptances_user_doc_version\s+ON legal_acceptances /,
];

const DENIED_PATTERNS: RegExp[] = [
  /\bDROP\b/i,
  /\bTRUNCATE\b/i,
  /\bALTER\b/i,
  /\bDELETE\b/i,
  /\bUPDATE\s+\w+\s+SET\b/i,
  /\bINSERT\b/i,
  /\bCONCURRENTLY\b/i,
  /^\s*(BEGIN|COMMIT)\s*;/im,
];

/**
 * Guard de la migración (R8): solo DDL aditivo sobre la tabla nueva. Devuelve
 * las violaciones encontradas; vacío = migración segura.
 */
function findViolations(sql: string): string[] {
  const ddl = stripComments(sql);
  const violations: string[] = [];

  for (const statement of ddl
    .split(';')
    .map((part) => part.trim())
    .filter((part) => part.length > 0)) {
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

describe('legal acceptances migration (20261015120000)', () => {
  const ddl = stripComments(migration);

  it('passes the allowlist/denylist guard (additive only)', () => {
    expect(findViolations(migration)).toEqual([]);
  });

  it('contains exactly the table and the unique index statements', () => {
    const statements = ddl
      .split(';')
      .map((part) => part.trim())
      .filter((part) => part.length > 0);
    expect(statements).toHaveLength(2);
  });

  describe('guard negative cases', () => {
    it.each([
      ['DROP TABLE', 'DROP TABLE legal_acceptances;'],
      ['ALTER TABLE', 'ALTER TABLE users ADD COLUMN x int;'],
      ['TRUNCATE', 'TRUNCATE legal_acceptances;'],
      ['DELETE', 'DELETE FROM legal_acceptances;'],
      ['UPDATE ... SET', "UPDATE users SET email = 'x';"],
      ['INSERT', 'INSERT INTO legal_acceptances (user_id) VALUES (NULL);'],
      [
        'CONCURRENTLY',
        'CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS uq_legal_acceptances_user_doc_version ON legal_acceptances (user_id);',
      ],
      ['BEGIN', 'BEGIN;'],
      ['COMMIT', 'COMMIT;'],
      ['an unrelated statement', 'CREATE TABLE IF NOT EXISTS other (id int);'],
    ])('fails when an extra %s statement is appended', (_label, extra) => {
      expect(findViolations(`${migration}\n${extra}\n`)).not.toEqual([]);
    });

    it('ignores forbidden words that only appear inside -- comments', () => {
      expect(
        findViolations(`-- DROP TABLE x; ALTER TABLE y;\n${migration}`),
      ).toEqual([]);
    });
  });

  it('creates the table IF NOT EXISTS with the documented columns', () => {
    expect(ddl).toMatch(/CREATE TABLE IF NOT EXISTS legal_acceptances \(/);
    for (const column of [
      /legal_acceptance_id\s+uuid\s+NOT NULL DEFAULT gen_random_uuid\(\)/,
      /user_id\s+uuid\s+NOT NULL,/,
      /document_type\s+varchar\(16\)\s+NOT NULL,/,
      /document_version\s+varchar\(32\)\s+NOT NULL,/,
      /accepted_at\s+timestamptz\(6\)\s+NOT NULL DEFAULT now\(\)/,
      /method\s+varchar\(32\)\s+NOT NULL,/,
      /ip_address\s+varchar\(45\),/,
      /user_agent\s+varchar\(512\),/,
      /accepted_by_user_id\s+uuid,/,
      /created_at\s+timestamptz\(6\)\s+NOT NULL DEFAULT now\(\)/,
    ]) {
      expect(ddl).toMatch(column);
    }
  });

  it('declares the primary key and both FKs with the default NO ACTION', () => {
    expect(ddl).toMatch(
      /CONSTRAINT legal_acceptances_pkey PRIMARY KEY \(legal_acceptance_id\)/,
    );
    for (const column of ['user_id', 'accepted_by_user_id']) {
      expect(ddl).toMatch(
        new RegExp(
          `CONSTRAINT legal_acceptances_${column}_fkey FOREIGN KEY \\(${column}\\)\\s+REFERENCES users \\(user_id\\),`,
        ),
      );
    }
    // Sin cláusulas ON ...: Postgres aplica NO ACTION, igual que el schema de
    // Prisma. Así la palabra DELETE no aparece en el SQL y el denylist es estricto.
    expect(ddl).not.toMatch(/\bON\s+(DELETE|UPDATE)\b/i);
  });

  it('declares the CHECK constraints', () => {
    expect(ddl).toMatch(
      /CONSTRAINT legal_acceptances_document_type_ck CHECK \(document_type IN \('terms', 'privacy'\)\)/,
    );
    expect(ddl).toMatch(
      /CONSTRAINT legal_acceptances_method_ck CHECK \(method IN \('register_checkbox', 'acceptance_gate'\)\)/,
    );
    expect(ddl).toMatch(
      /CONSTRAINT legal_acceptances_document_version_ck CHECK \(char_length\(btrim\(document_version\)\) BETWEEN 1 AND 32\)/,
    );
  });

  it('creates the unique index (user, type, version) without CONCURRENTLY', () => {
    expect(ddl).toMatch(
      /CREATE UNIQUE INDEX IF NOT EXISTS uq_legal_acceptances_user_doc_version\s+ON legal_acceptances \(user_id, document_type, document_version\);/,
    );
    expect(ddl).not.toMatch(/\bCONCURRENTLY\b/i);
  });

  it('documents that Render migrates at the end of the build (no preDeploy)', () => {
    expect(migration).toMatch(/END OF THE BUILD/);
    expect(migration).toMatch(/no\s+-- preDeploy|no\s+preDeploy/i);
  });

  it('matches the Prisma schema (fields, relations and back-relations)', () => {
    const { models } = Prisma.dmmf.datamodel;
    const model = models.find((entry) => entry.name === 'legal_acceptances');
    expect(model?.fields.map((field) => field.name)).toEqual(
      expect.arrayContaining([
        'legal_acceptance_id',
        'user_id',
        'document_type',
        'document_version',
        'accepted_at',
        'method',
        'ip_address',
        'user_agent',
        'accepted_by_user_id',
        'created_at',
        'user',
        'accepted_by',
      ]),
    );
    expect(schema).toMatch(
      /model legal_acceptances \{[\s\S]*?@@unique\(\[user_id, document_type, document_version\], map: "uq_legal_acceptances_user_doc_version"\)[\s\S]*?\}/,
    );
    expect(schema).toMatch(
      /onDelete: NoAction, onUpdate: NoAction, map: "legal_acceptances_user_id_fkey"/,
    );
    expect(schema).toMatch(
      /onDelete: NoAction, onUpdate: NoAction, map: "legal_acceptances_accepted_by_user_id_fkey"/,
    );
    expect(
      models.find((entry) => entry.name === 'users')?.fields.map((f) => f.name),
    ).toEqual(
      expect.arrayContaining(['legal_acceptances', 'legal_acceptances_given']),
    );
  });
});
