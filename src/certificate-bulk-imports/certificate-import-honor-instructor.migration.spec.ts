import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Prisma } from '@prisma/client';

const migration = readFileSync(
  join(
    __dirname,
    '../../prisma/migrations/20261010120000_certificate_import_honor_instructor/migration.sql',
  ),
  'utf8',
);
/** El SQL sin comentarios: así los avisos del encabezado no cuentan como DDL. */
const ddl = migration
  .split('\n')
  .filter((line) => !line.trim().startsWith('--'))
  .join('\n');

describe('certificate import honor instructor migration (M1, 20261010120000)', () => {
  it('adds the nullable columns to items and users_honors', () => {
    for (const table of ['certificate_bulk_import_items', 'users_honors']) {
      expect(ddl).toMatch(
        new RegExp(
          `ALTER TABLE ${table}\\s+ADD COLUMN IF NOT EXISTS instructor_user_id uuid,\\s+ADD COLUMN IF NOT EXISTS instructor_name varchar\\(150\\);`,
        ),
      );
    }
    const addColumns = ddl
      .split('\n')
      .filter((line) => /ADD COLUMN/.test(line));
    expect(addColumns).toHaveLength(4);
    expect(addColumns.join('\n')).not.toMatch(/NOT NULL|DEFAULT/i);
  });

  it('adds both FKs to users(user_id) with NO ACTION, NOT VALID, then validates', () => {
    for (const fk of [
      'certificate_bulk_import_items_instructor_user_id_fkey',
      'users_honors_instructor_user_id_fkey',
    ]) {
      expect(ddl).toMatch(
        new RegExp(
          `ADD CONSTRAINT ${fk}\\s+FOREIGN KEY \\(instructor_user_id\\) REFERENCES users \\(user_id\\)\\s+ON DELETE NO ACTION ON UPDATE NO ACTION NOT VALID`,
        ),
      );
      expect(ddl).toMatch(new RegExp(`VALIDATE CONSTRAINT ${fk};`));
    }
  });

  it('adds the exclusivity, HONOR-only and free-name CHECKs as NOT VALID and validates all of them', () => {
    const checks = [
      [
        'certificate_bulk_import_items_instructor_exclusive_ck',
        'instructor_user_id IS NULL OR instructor_name IS NULL',
      ],
      [
        'certificate_bulk_import_items_instructor_honor_ck',
        "item_type = 'HONOR' OR \\(instructor_user_id IS NULL AND instructor_name IS NULL\\)",
      ],
      [
        'certificate_bulk_import_items_instructor_name_ck',
        'instructor_name IS NULL OR char_length\\(btrim\\(instructor_name\\)\\) BETWEEN 3 AND 150',
      ],
      [
        'users_honors_instructor_exclusive_ck',
        'instructor_user_id IS NULL OR instructor_name IS NULL',
      ],
      [
        'users_honors_instructor_name_ck',
        'instructor_name IS NULL OR char_length\\(btrim\\(instructor_name\\)\\) BETWEEN 3 AND 150',
      ],
    ];
    for (const [name, expression] of checks) {
      expect(ddl).toMatch(
        new RegExp(
          `ADD CONSTRAINT ${name}\\s+CHECK \\(${expression}[^;]*\\) NOT VALID`,
        ),
      );
      expect(ddl).toMatch(new RegExp(`VALIDATE CONSTRAINT ${name};`));
    }
  });

  it('builds the partial indexes CONCURRENTLY and outside any transaction', () => {
    expect(ddl).toMatch(
      /CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_certificate_bulk_items_instructor_user\s+ON certificate_bulk_import_items \(instructor_user_id\)\s+WHERE instructor_user_id IS NOT NULL;/,
    );
    expect(ddl).toMatch(
      /CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_users_honors_instructor_user_approved\s+ON users_honors \(instructor_user_id\)\s+WHERE instructor_user_id IS NOT NULL AND active = true AND validation_status = 'APPROVED';/,
    );
    expect(ddl).not.toMatch(/\b(BEGIN|COMMIT|START TRANSACTION)\b/i);
  });

  it('is additive: nothing is dropped except the constraints it recreates', () => {
    expect(ddl).not.toMatch(/DROP (TABLE|COLUMN|INDEX|TYPE)/i);
    const drops = [...ddl.matchAll(/DROP CONSTRAINT IF EXISTS (\S+?),/g)].map(
      (match) => match[1],
    );
    for (const name of drops) {
      expect(ddl).toContain(`ADD CONSTRAINT ${name}`);
    }
  });

  it('matches the Prisma schema (columns and relations)', () => {
    const model = (name: string) =>
      Prisma.dmmf.datamodel.models.find((entry) => entry.name === name);
    for (const name of ['certificate_bulk_import_items', 'users_honors']) {
      const fields = model(name)?.fields ?? [];
      expect(fields).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            name: 'instructor_user_id',
            type: 'String',
          }),
          expect.objectContaining({
            name: 'instructor_name',
            type: 'String',
          }),
          expect.objectContaining({
            name: 'instructor',
            type: 'users',
            kind: 'object',
          }),
        ]),
      );
    }
    expect(model('users')?.fields.map((field) => field.name)).toEqual(
      expect.arrayContaining([
        'certificate_import_items_instructed',
        'honors_instructed',
      ]),
    );
  });
});
