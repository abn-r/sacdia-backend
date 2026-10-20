import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Prisma } from '@prisma/client';

const TEEN_LOGIN_MIGRATION = '20261020120000_family_teen_login';

const migration = readFileSync(
  join(
    __dirname,
    `../../prisma/migrations/${TEEN_LOGIN_MIGRATION}/migration.sql`,
  ),
  'utf8',
);

const schema = readFileSync(
  join(__dirname, '../../prisma/schema.prisma'),
  'utf8',
);

/** SQL sin comentarios: los avisos del encabezado no cuentan como DDL. */
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
  'uq_supervised_logins_handle',
  'idx_supervised_logins_pending',
];

const PHASE2_PURPOSES = ['second_guardian', 'director_claim'];
const PHASE2_REVOKED_REASONS = [
  'guardian_left',
  'removed_by_primary',
  'guardian_account_closed',
  'claimed',
  'admin',
  'released',
];

/**
 * Allowlist de la migración 3a. Cada patrón está anclado. Los DROP CONSTRAINT
 * quedan permitidos SOLO para los dos CHECK que se ensanchan (drop + add).
 */
const ALLOWED_STATEMENTS: RegExp[] = [
  /^CREATE TABLE IF NOT EXISTS supervised_logins \(/,
  new RegExp(
    `^CREATE (UNIQUE )?INDEX IF NOT EXISTS (${INDEX_NAMES.join('|')})\\s+ON `,
  ),
  /^ALTER TABLE guardianship_link_codes DROP CONSTRAINT IF EXISTS guardianship_link_codes_purpose_ck$/,
  /^ALTER TABLE guardianship_link_codes ADD CONSTRAINT guardianship_link_codes_purpose_ck\s+CHECK \(purpose IN \('second_guardian', 'director_claim', 'teen_guardian_link'\)\)$/,
  /^ALTER TABLE guardianships DROP CONSTRAINT IF EXISTS guardianships_revoked_reason_ck$/,
  /^ALTER TABLE guardianships ADD CONSTRAINT guardianships_revoked_reason_ck\s+CHECK \(revoked_reason IS NULL OR revoked_reason IN \([^)]*\)\)$/,
];

/** Denylist de la fase 2, salvo DROP CONSTRAINT que se valida por allowlist. */
const DENIED_PATTERNS: RegExp[] = [
  /\bDROP\s+(TABLE|COLUMN|INDEX|SCHEMA|TYPE|VIEW|DEFAULT|FUNCTION|TRIGGER)\b/i,
  /\bSET\s+NOT\s+NULL\b/i,
  /\bRENAME\b/i,
  /\bALTER\s+COLUMN\b/i,
  /\bTRUNCATE\b/i,
  /\bDELETE\b/i,
  /\bUPDATE\s+\w+\s+SET\b/i,
  /\bINSERT\b/i,
  /\bCONCURRENTLY\b/i,
  /^\s*(BEGIN|COMMIT)\s*;/im,
  /\bON\s+(DELETE|UPDATE)\b/i,
  /\bREFERENCES\s+sessions\b/i,
];

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
  // ALTER TABLE ... DROP CONSTRAINT solo con IF EXISTS sobre los dos CHECK.
  for (const dropped of ddl.matchAll(
    /DROP\s+CONSTRAINT\s+(IF EXISTS\s+)?(\w+)/gi,
  )) {
    if (
      ![
        'guardianship_link_codes_purpose_ck',
        'guardianships_revoked_reason_ck',
      ].includes(dropped[2])
    ) {
      violations.push(`denied: DROP CONSTRAINT ${dropped[2]}`);
    }
  }
  return violations;
}

const listOf = (statement: string): string[] => {
  const inner = statement.match(/IN \(([^)]*)\)/)?.[1] ?? '';
  return inner
    .split(',')
    .map((part) => part.trim().replace(/^'|'$/g, ''))
    .filter(Boolean);
};

describe('family profiles phase 3a migration (20261020120000)', () => {
  const ddl = stripComments(migration);
  const statements = splitStatements(migration);

  it('passes the allowlist/denylist guard', () => {
    expect(findViolations(migration)).toEqual([]);
  });

  it('contains exactly 7 statements: 1 CREATE TABLE, 2 indexes and 2 constraint DROP+ADD pairs', () => {
    expect(statements).toHaveLength(7);
    expect(statements.filter((s) => s.startsWith('CREATE TABLE'))).toHaveLength(
      1,
    );
    expect(
      statements.filter((s) => /^CREATE (UNIQUE )?INDEX/.test(s)),
    ).toHaveLength(2);
    expect(
      statements.filter((s) => /DROP CONSTRAINT IF EXISTS/.test(s)),
    ).toHaveLength(2);
    expect(statements.filter((s) => /ADD CONSTRAINT/.test(s))).toHaveLength(2);
  });

  it('contains no DML and no ON DELETE/ON UPDATE clauses', () => {
    expect(ddl).not.toMatch(/\b(INSERT|UPDATE|DELETE|TRUNCATE)\b/i);
    expect(ddl).not.toMatch(/\bON\s+(DELETE|UPDATE)\b/i);
  });

  it('is re-runnable: creates carry IF NOT EXISTS and every drop carries IF EXISTS', () => {
    for (const statement of statements) {
      expect(statement).toMatch(
        /^(CREATE TABLE IF NOT EXISTS|CREATE (UNIQUE )?INDEX IF NOT EXISTS|ALTER TABLE \w+ DROP CONSTRAINT IF EXISTS|ALTER TABLE \w+ ADD CONSTRAINT)\b/,
      );
    }
    // Cada ADD CONSTRAINT está precedido por su DROP IF EXISTS (idempotencia por patrón).
    const order = statements.map((s) =>
      /DROP CONSTRAINT IF EXISTS (\w+)/.exec(s)
        ? `drop:${/DROP CONSTRAINT IF EXISTS (\w+)/.exec(s)![1]}`
        : /ADD CONSTRAINT (\w+)/.exec(s)
          ? `add:${/ADD CONSTRAINT (\w+)/.exec(s)![1]}`
          : null,
    );
    for (const name of [
      'guardianship_link_codes_purpose_ck',
      'guardianships_revoked_reason_ck',
    ]) {
      const dropAt = order.indexOf(`drop:${name}`);
      const addAt = order.indexOf(`add:${name}`);
      expect(dropAt).toBeGreaterThanOrEqual(0);
      expect(addAt).toBe(dropAt + 1);
    }
  });

  it('never adds a foreign key to sessions (ADR-4)', () => {
    expect(ddl).not.toMatch(/REFERENCES\s+sessions\b/i);
    expect(ddl).not.toMatch(/ALTER TABLE sessions\b/i);
  });

  it('only WIDENS the purpose CHECK: a superset of the Phase 2 purposes plus teen_guardian_link', () => {
    const add = statements.find((s) =>
      /ADD CONSTRAINT guardianship_link_codes_purpose_ck/.test(s),
    )!;
    const purposes = listOf(add);
    for (const phase2 of PHASE2_PURPOSES) {
      expect(purposes).toContain(phase2);
    }
    expect(purposes).toContain('teen_guardian_link');
    expect(purposes).toHaveLength(PHASE2_PURPOSES.length + 1);
  });

  it('only WIDENS the revoked_reason CHECK: a superset of Phase 2 plus removed_by_dependent', () => {
    const add = statements.find((s) =>
      /ADD CONSTRAINT guardianships_revoked_reason_ck/.test(s),
    )!;
    const reasons = listOf(add);
    for (const phase2 of PHASE2_REVOKED_REASONS) {
      expect(reasons).toContain(phase2);
    }
    expect(reasons).toContain('removed_by_dependent');
    expect(reasons).toHaveLength(PHASE2_REVOKED_REASONS.length + 1);
  });

  it('keeps guardianship_link_codes_section_ck untouched (director_claim stays the only section purpose)', () => {
    expect(ddl).not.toMatch(/guardianship_link_codes_section_ck/);
  });

  it('declares both index names with the partial/expression predicates', () => {
    for (const name of INDEX_NAMES) {
      expect(ddl).toMatch(
        new RegExp(`CREATE (UNIQUE )?INDEX IF NOT EXISTS ${name}\\b`),
      );
    }
    expect(ddl).toMatch(
      /CREATE UNIQUE INDEX IF NOT EXISTS uq_supervised_logins_handle ON supervised_logins \(lower\(login_handle\)\) WHERE login_handle IS NOT NULL/,
    );
    expect(ddl).toMatch(
      /idx_supervised_logins_pending ON supervised_logins \(pending_since\) WHERE pending_since IS NOT NULL AND disabled_at IS NULL/,
    );
  });

  it('declares the supervised_logins constraints (one login per user, handle iff method, disabled iff reason)', () => {
    for (const check of [
      'supervised_logins_method_ck',
      'supervised_logins_origin_ck',
      'supervised_logins_password_set_by_ck',
      'supervised_logins_handle_ck',
      'supervised_logins_handle_format_ck',
      'supervised_logins_guardian_enabled_ck',
      'supervised_logins_reminder_ck',
      'supervised_logins_disabled_ck',
      'supervised_logins_disabled_reason_ck',
    ]) {
      expect(ddl).toMatch(new RegExp(`CONSTRAINT ${check} CHECK`));
    }
    expect(ddl).toMatch(
      /CONSTRAINT supervised_logins_pkey PRIMARY KEY \(user_id\)/,
    );
    expect(ddl).toMatch(
      /CONSTRAINT supervised_logins_handle_ck CHECK \(\(method = 'handle'\) = \(login_handle IS NOT NULL\)\)/,
    );
    expect(ddl).toMatch(
      /CONSTRAINT supervised_logins_disabled_ck CHECK \(\(disabled_at IS NULL\) = \(disabled_reason IS NULL\)\)/,
    );
  });

  it('allows reminder levels 0..3 (day 7, 30 and 83 per ruling R1)', () => {
    expect(ddl).toMatch(
      /CONSTRAINT supervised_logins_reminder_ck CHECK \(pending_reminder_level BETWEEN 0 AND 3\)/,
    );
  });

  describe('guard negative cases', () => {
    it.each([
      ['DROP TABLE guardianships', 'DROP TABLE guardianships;'],
      ['DROP TABLE supervised_logins', 'DROP TABLE supervised_logins;'],
      ['UPDATE users', 'UPDATE users SET email = NULL;'],
      [
        'INSERT into supervised_logins',
        "INSERT INTO supervised_logins (user_id) VALUES ('x');",
      ],
      ['TRUNCATE', 'TRUNCATE guardianships;'],
      ['BEGIN', 'BEGIN;'],
      ['COMMIT', 'COMMIT;'],
      [
        'CONCURRENTLY',
        'CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_supervised_logins_pending ON supervised_logins (pending_since);',
      ],
      [
        'DROP of section_ck',
        'ALTER TABLE guardianship_link_codes DROP CONSTRAINT guardianship_link_codes_section_ck;',
      ],
      [
        'a purpose CHECK without director_claim',
        "ALTER TABLE guardianship_link_codes ADD CONSTRAINT guardianship_link_codes_purpose_ck CHECK (purpose IN ('second_guardian', 'teen_guardian_link'));",
      ],
      [
        'an FK to sessions',
        'CREATE TABLE IF NOT EXISTS supervised_logins (session_id text REFERENCES sessions(id));',
      ],
      [
        'ALTER TABLE sessions ADD COLUMN',
        'ALTER TABLE sessions ADD COLUMN kind varchar(8);',
      ],
      [
        'ON DELETE CASCADE',
        'ALTER TABLE guardianships ADD CONSTRAINT x FOREIGN KEY (a) REFERENCES users (user_id) ON DELETE CASCADE;',
      ],
      ['an unrelated table', 'CREATE TABLE IF NOT EXISTS other (id int);'],
    ])('fails when an extra %s statement is appended', (_label, extra) => {
      expect(findViolations(`${migration}\n${extra}\n`)).not.toEqual([]);
    });

    it('rejects a narrowed purpose CHECK that drops a Phase 2 value even with the right name', () => {
      const narrowed = migration.replace(
        "'second_guardian', 'director_claim', 'teen_guardian_link'",
        "'second_guardian', 'teen_guardian_link'",
      );
      expect(findViolations(narrowed)).not.toEqual([]);
    });

    it('ignores forbidden words that only appear inside -- comments', () => {
      expect(
        findViolations(`-- DROP TABLE x; INSERT y;\n${migration}`),
      ).toEqual([]);
    });
  });

  it('matches the Prisma schema (model, fields, relations, SQL-only indexes)', () => {
    const { models } = Prisma.dmmf.datamodel;
    const fieldNames = (name: string): string[] | undefined =>
      models.find((entry) => entry.name === name)?.fields.map((f) => f.name);

    expect(fieldNames('supervised_logins')).toEqual(
      expect.arrayContaining([
        'user_id',
        'method',
        'login_handle',
        'origin',
        'enabled_by_guardianship_id',
        'enabled_by_user_id',
        'enabled_at',
        'password_set_by',
        'pending_since',
        'pending_reminder_level',
        'disabled_at',
        'disabled_by_user_id',
        'disabled_reason',
        'created_at',
        'modified_at',
        'user',
        'enabled_by',
        'disabled_by',
        'enabled_by_guardianship',
      ]),
    );
    expect(fieldNames('users')).toEqual(
      expect.arrayContaining([
        'supervised_login',
        'supervised_logins_enabled',
        'supervised_logins_disabled',
      ]),
    );
    expect(fieldNames('guardianships')).toContain('supervised_logins');

    for (const name of INDEX_NAMES) {
      expect(schema).toContain(name);
    }
    expect(schema).toContain(TEEN_LOGIN_MIGRATION);
  });
});
