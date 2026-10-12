import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Prisma } from '@prisma/client';

const migration = readFileSync(
  join(
    __dirname,
    '../../prisma/migrations/20261010130000_certificate_import_ocr_pages/migration.sql',
  ),
  'utf8',
);
/** El SQL sin comentarios: así los avisos del encabezado no cuentan como DDL. */
const ddl = migration
  .split('\n')
  .filter((line) => !line.trim().startsWith('--'))
  .join('\n');

describe('certificate import OCR pages migration (M2, 20261010130000)', () => {
  it('adds the three nullable columns with no default', () => {
    expect(ddl).toMatch(
      /ALTER TABLE certificate_bulk_import_files\s+ADD COLUMN IF NOT EXISTS page_count smallint;/,
    );
    expect(ddl).toMatch(
      /ALTER TABLE certificate_bulk_import_items\s+ADD COLUMN IF NOT EXISTS source_page smallint,\s+ADD COLUMN IF NOT EXISTS source_file_id uuid;/,
    );
    const addColumns = ddl
      .split('\n')
      .filter((line) => /ADD COLUMN/.test(line));
    expect(addColumns).toHaveLength(3);
    expect(addColumns.join('\n')).not.toMatch(/NOT NULL|DEFAULT/i);
  });

  it('references certificate_bulk_import_files with ON DELETE SET NULL, NOT VALID, then validates', () => {
    expect(ddl).toMatch(
      /ADD CONSTRAINT certificate_bulk_import_items_source_file_id_fkey\s+FOREIGN KEY \(source_file_id\) REFERENCES certificate_bulk_import_files \(file_id\)\s+ON DELETE SET NULL ON UPDATE NO ACTION NOT VALID/,
    );
    expect(ddl).toMatch(
      /VALIDATE CONSTRAINT certificate_bulk_import_items_source_file_id_fkey;/,
    );
  });

  it('adds the source_page and page_count CHECKs as NOT VALID and validates them', () => {
    expect(ddl).toMatch(
      /ADD CONSTRAINT certificate_bulk_import_items_source_page_ck\s+CHECK \(source_page IS NULL OR source_page >= 1\) NOT VALID/,
    );
    expect(ddl).toMatch(
      /ADD CONSTRAINT certificate_bulk_import_files_page_count_ck\s+CHECK \(page_count IS NULL OR page_count >= 1\) NOT VALID/,
    );
    expect(ddl).toMatch(
      /VALIDATE CONSTRAINT certificate_bulk_import_items_source_page_ck;/,
    );
    expect(ddl).toMatch(
      /VALIDATE CONSTRAINT certificate_bulk_import_files_page_count_ck;/,
    );
  });

  it('has no CHECK tying source_page to source_file_id and no hard-coded 5-page cap', () => {
    const checks = [...ddl.matchAll(/CHECK \(([^;]*?)\) NOT VALID/g)].map(
      (match) => match[1],
    );
    expect(checks).toHaveLength(2);
    for (const expression of checks) {
      expect(expression).not.toMatch(/source_file_id/);
      expect(expression).not.toMatch(/<=\s*5|BETWEEN 1 AND 5/);
    }
  });

  it('builds the partial index CONCURRENTLY and outside any transaction', () => {
    expect(ddl).toMatch(
      /CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_certificate_bulk_items_source_file\s+ON certificate_bulk_import_items \(source_file_id\)\s+WHERE source_file_id IS NOT NULL;/,
    );
    expect(ddl).not.toMatch(/\b(BEGIN|COMMIT|START TRANSACTION)\b/i);
  });

  it('is additive: nothing is dropped except the constraints it recreates', () => {
    expect(ddl).not.toMatch(/DROP (TABLE|COLUMN|INDEX|TYPE)/i);
    const drops = [...ddl.matchAll(/DROP CONSTRAINT IF EXISTS (\S+?),/g)].map(
      (match) => match[1],
    );
    expect(drops).toHaveLength(3);
    for (const name of drops) {
      expect(ddl).toContain(`ADD CONSTRAINT ${name}`);
    }
  });

  it('matches the Prisma schema (columns and the SET NULL relation)', () => {
    const model = (name: string) =>
      Prisma.dmmf.datamodel.models.find((entry) => entry.name === name);
    expect(model('certificate_bulk_import_files')?.fields).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'page_count', type: 'Int' }),
        expect.objectContaining({ name: 'items_sourced', kind: 'object' }),
      ]),
    );
    expect(model('certificate_bulk_import_items')?.fields).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'source_page', type: 'Int' }),
        expect.objectContaining({ name: 'source_file_id', type: 'String' }),
        expect.objectContaining({
          name: 'source_file',
          type: 'certificate_bulk_import_files',
          kind: 'object',
        }),
      ]),
    );
  });
});
