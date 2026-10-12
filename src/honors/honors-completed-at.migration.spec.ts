import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Prisma } from '@prisma/client';
import { MIN_CERTIFICATE_DATE } from '../common/utils/honor-date-range';

const migration = readFileSync(
  join(
    __dirname,
    '../../prisma/migrations/20261012130000_honors_completed_at/migration.sql',
  ),
  'utf8',
);
/** El SQL sin comentarios: así los avisos del encabezado no cuentan como DDL. */
const ddl = migration
  .split('\n')
  .filter((line) => !line.trim().startsWith('--'))
  .join('\n');

describe('users_honors.completed_at migration (M5, 20261012130000)', () => {
  it('adds one nullable date column with no default', () => {
    expect(ddl).toMatch(
      /ALTER TABLE users_honors\s+ADD COLUMN IF NOT EXISTS completed_at date;/,
    );
    const addColumns = ddl
      .split('\n')
      .filter((line) => /ADD COLUMN/.test(line));
    expect(addColumns).toHaveLength(1);
    expect(addColumns.join('\n')).not.toMatch(/NOT NULL|DEFAULT/i);
  });

  it('adds the 1960 lower-bound CHECK as NOT VALID and then validates it', () => {
    expect(ddl).toMatch(
      /ADD CONSTRAINT users_honors_completed_at_min_ck\s+CHECK \(completed_at IS NULL OR completed_at >= DATE '1960-01-01'\) NOT VALID/,
    );
    expect(ddl).toMatch(
      /VALIDATE CONSTRAINT users_honors_completed_at_min_ck;/,
    );
    // El DDL y la constante de la app no pueden desfasarse.
    expect(MIN_CERTIFICATE_DATE).toBe('1960-01-01');
  });

  it('has no upper bound (the database does not know "today")', () => {
    expect(ddl).not.toMatch(/CURRENT_DATE|now\(\)/i);
  });

  it('is additive, re-runnable and transaction-agnostic', () => {
    expect(ddl).not.toMatch(/DROP (TABLE|COLUMN|INDEX|TYPE)/i);
    expect(ddl).not.toMatch(/CONCURRENTLY/i);
    expect(ddl).not.toMatch(/\b(BEGIN|COMMIT|START TRANSACTION)\b/i);
    expect(ddl).toMatch(
      /DROP CONSTRAINT IF EXISTS users_honors_completed_at_min_ck,\s+ADD CONSTRAINT users_honors_completed_at_min_ck/,
    );
  });

  describe('backfill of certificate-imported rows', () => {
    const backfill = /UPDATE users_honors uh[\s\S]*?;/.exec(ddl)?.[0] ?? '';

    it('copies date to completed_at and nothing else', () => {
      expect(backfill).toMatch(/SET completed_at = uh\.date\s+FROM/);
      expect(backfill).not.toMatch(/modified_at|validation_status\s*=\s*'IN/);
      expect(ddl.match(/\bUPDATE\b/g)).toHaveLength(1);
    });

    it('only trusts approved rows linked to an approved HONOR item with the same date', () => {
      for (const condition of [
        "i.applied_entity_type = 'USER_HONOR'",
        'i.applied_entity_id = uh.user_honor_id',
        "i.item_type = 'HONOR'",
        "i.status = 'APPROVED'",
        "uh.validation_status = 'APPROVED'",
        'uh.completed_at IS NULL',
        'i.completed_at = uh.date',
        "uh.date >= DATE '1960-01-01'",
      ]) {
        expect(backfill).toContain(condition);
      }
    });
  });

  it('matches the Prisma schema', () => {
    const field = Prisma.dmmf.datamodel.models
      .find((model) => model.name === 'users_honors')
      ?.fields.find((entry) => entry.name === 'completed_at');
    expect(field).toEqual(
      expect.objectContaining({ kind: 'scalar', type: 'DateTime' }),
    );
  });
});
