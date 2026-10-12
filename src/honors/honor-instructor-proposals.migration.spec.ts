import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Prisma, honor_instructor_proposal_status_enum } from '@prisma/client';

const migration = readFileSync(
  join(
    __dirname,
    '../../prisma/migrations/20261013100000_honor_instructor_proposals/migration.sql',
  ),
  'utf8',
);
/** El SQL sin comentarios: así los avisos del encabezado no cuentan como DDL. */
const ddl = migration
  .split('\n')
  .filter((line) => !line.trim().startsWith('--'))
  .join('\n');

describe('honor instructor proposals migration (M4, 20261013100000)', () => {
  it('creates the status enum with the four states, tolerating a re-run', () => {
    expect(ddl).toMatch(
      /CREATE TYPE honor_instructor_proposal_status_enum AS ENUM \(\s*'PENDING',\s*'APPROVED',\s*'REJECTED',\s*'WITHDRAWN'\s*\);/,
    );
    expect(ddl).toMatch(/WHEN duplicate_object THEN NULL/);
  });

  it('creates the table IF NOT EXISTS with the documented columns', () => {
    expect(ddl).toMatch(
      /CREATE TABLE IF NOT EXISTS honor_instructor_proposals \(/,
    );
    for (const column of [
      /proposal_id\s+uuid PRIMARY KEY DEFAULT gen_random_uuid\(\)/,
      /user_honor_id\s+integer NOT NULL/,
      /proposed_by_id\s+uuid NOT NULL/,
      /instructor_user_id\s+uuid,/,
      /instructor_name\s+varchar\(150\),/,
      /status\s+honor_instructor_proposal_status_enum NOT NULL DEFAULT 'PENDING'/,
      /rejection_reason\s+text,/,
      /reviewed_by_id\s+uuid,/,
      /reviewed_at\s+timestamptz,/,
      /created_at\s+timestamptz NOT NULL DEFAULT now\(\)/,
      /modified_at\s+timestamptz NOT NULL DEFAULT now\(\)/,
    ]) {
      expect(ddl).toMatch(column);
    }
  });

  it('adds the four FKs with NO ACTION, NOT VALID, then validates them', () => {
    const fks: Array<[string, string, string]> = [
      ['user_honor_id', 'users_honors', 'user_honor_id'],
      ['proposed_by_id', 'users', 'user_id'],
      ['instructor_user_id', 'users', 'user_id'],
      ['reviewed_by_id', 'users', 'user_id'],
    ];
    for (const [column, table, target] of fks) {
      const name = `honor_instructor_proposals_${column}_fkey`;
      expect(ddl).toMatch(
        new RegExp(
          `ADD CONSTRAINT ${name}\\s+FOREIGN KEY \\(${column}\\) REFERENCES ${table} \\(${target}\\)\\s+ON DELETE NO ACTION ON UPDATE NO ACTION NOT VALID`,
        ),
      );
      expect(ddl).toMatch(
        new RegExp(
          `ALTER TABLE honor_instructor_proposals VALIDATE CONSTRAINT ${name};`,
        ),
      );
    }
  });

  it('adds the CHECKs as NOT VALID and validates each one', () => {
    const checks: Array<[string, string]> = [
      [
        'one_instructor_ck',
        '\\(instructor_user_id IS NULL\\) <> \\(instructor_name IS NULL\\)',
      ],
      [
        'name_ck',
        'instructor_name IS NULL OR char_length\\(btrim\\(instructor_name\\)\\) BETWEEN 3 AND 150',
      ],
      [
        'review_ck',
        "\\(status IN \\('APPROVED', 'REJECTED'\\)\\) = \\(reviewed_by_id IS NOT NULL AND reviewed_at IS NOT NULL\\)",
      ],
      [
        'reason_ck',
        "status <> 'REJECTED' OR \\(rejection_reason IS NOT NULL AND char_length\\(btrim\\(rejection_reason\\)\\) BETWEEN 3 AND 500\\)",
      ],
    ];
    for (const [suffix, expression] of checks) {
      const name = `honor_instructor_proposals_${suffix}`;
      expect(ddl).toMatch(
        new RegExp(`ADD CONSTRAINT ${name}\\s+CHECK \\(${expression}\\) NOT VALID`),
      );
      expect(ddl).toMatch(
        new RegExp(
          `ALTER TABLE honor_instructor_proposals VALIDATE CONSTRAINT ${name};`,
        ),
      );
    }
  });

  it('rejects a REJECTED row with a NULL reason (explicit IS NOT NULL guard)', () => {
    // `status <> 'REJECTED' OR char_length(btrim(NULL)) BETWEEN 3 AND 500` evaluates to NULL
    // and a CHECK lets NULL through; the guard makes the reason mandatory.
    expect(ddl).toMatch(/rejection_reason IS NOT NULL AND char_length/);
  });

  it('builds the partial indexes CONCURRENTLY and outside any transaction', () => {
    expect(ddl).toMatch(
      /CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS uq_honor_instructor_proposals_pending\s+ON honor_instructor_proposals \(user_honor_id\)\s+WHERE status = 'PENDING';/,
    );
    expect(ddl).toMatch(
      /CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_honor_instructor_proposals_queue\s+ON honor_instructor_proposals \(created_at\)\s+WHERE status = 'PENDING';/,
    );
    expect(ddl).toMatch(
      /CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_honor_instructor_proposals_honor\s+ON honor_instructor_proposals \(user_honor_id, created_at DESC\);/,
    );
    // El BEGIN del bloque DO ... END no cuenta: se busca el control de transacción.
    expect(ddl).not.toMatch(/^\s*(BEGIN|COMMIT|START TRANSACTION)\s*;/im);
  });

  it('is additive: touches no other table and only drops what it recreates', () => {
    expect(ddl).not.toMatch(/DROP (TABLE|COLUMN|INDEX|TYPE)/i);
    expect(ddl).not.toMatch(/ALTER TABLE (?!honor_instructor_proposals)/);
    const drops = [...ddl.matchAll(/DROP CONSTRAINT IF EXISTS (\S+?),/g)].map(
      (match) => match[1],
    );
    expect(drops.length).toBeGreaterThan(0);
    for (const name of drops) {
      expect(ddl).toContain(`ADD CONSTRAINT ${name}`);
    }
  });

  it('keeps every validation_logs action within varchar(20)', () => {
    for (const action of [
      'instructor_proposed',
      'instructor_withdrawn',
      'instructor_approved',
      'instructor_rejected',
    ]) {
      expect(action.length).toBeLessThanOrEqual(20);
    }
  });

  it('matches the Prisma schema (enum, columns and relations)', () => {
    const { models } = Prisma.dmmf.datamodel;
    const proposals = models.find(
      (entry) => entry.name === 'honor_instructor_proposals',
    );
    expect(proposals?.fields.map((field) => field.name)).toEqual(
      expect.arrayContaining([
        'proposal_id',
        'user_honor_id',
        'proposed_by_id',
        'instructor_user_id',
        'instructor_name',
        'status',
        'rejection_reason',
        'reviewed_by_id',
        'reviewed_at',
        'created_at',
        'modified_at',
        'user_honor',
        'proposed_by',
        'instructor',
        'reviewed_by',
      ]),
    );
    expect(Object.values(honor_instructor_proposal_status_enum)).toEqual([
      'PENDING',
      'APPROVED',
      'REJECTED',
      'WITHDRAWN',
    ]);
    expect(
      models
        .find((entry) => entry.name === 'users_honors')
        ?.fields.map((field) => field.name),
    ).toContain('instructor_proposals');
    expect(
      models.find((entry) => entry.name === 'users')?.fields.map((f) => f.name),
    ).toEqual(
      expect.arrayContaining([
        'honor_instructor_proposals_proposed',
        'honor_instructor_proposals_as_instructor',
        'honor_instructor_proposals_reviewed',
      ]),
    );
  });
});
