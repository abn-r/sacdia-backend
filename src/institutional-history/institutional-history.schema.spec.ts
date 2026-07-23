import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const MIGRATION_PATH = join(
  process.cwd(),
  'prisma/migrations/20260723120000_institutional_history_foundation/migration.sql',
);

function readMigration(): string {
  return readFileSync(MIGRATION_PATH, 'utf8');
}

describe('institutional history foundation schema', () => {
  let sql: string;

  beforeAll(() => {
    sql = readMigration();
  });

  it('creates the reorganization ledger, participants, lineage and name versions', () => {
    expect(sql).toMatch(/CREATE TABLE\s+institutional_reorganizations\b/i);
    expect(sql).toMatch(
      /CREATE TABLE\s+institutional_reorganization_participants\b/i,
    );
    expect(sql).toMatch(/CREATE TABLE\s+institutional_lineage_edges\b/i);
    expect(sql).toMatch(/CREATE TABLE\s+institutional_name_versions\b/i);
    expect(sql).toMatch(
      /CREATE TABLE\s+institutional_name_version_translations\b/i,
    );
  });

  it('adds bitemporal columns to the five relationship history tables', () => {
    for (const table of [
      'union_division_history',
      'local_field_union_history',
      'district_local_field_history',
      'church_district_history',
      'club_institutional_history',
    ]) {
      expect(sql).toMatch(
        new RegExp(`ALTER TABLE\\s+${table}[\\s\\S]*?recorded_from`, 'i'),
      );
      expect(sql).toMatch(
        new RegExp(`ALTER TABLE\\s+${table}[\\s\\S]*?recorded_to`, 'i'),
      );
      expect(sql).toMatch(
        new RegExp(
          `ALTER TABLE\\s+${table}[\\s\\S]*?supersedes_history_id`,
          'i',
        ),
      );
      expect(sql).toMatch(
        new RegExp(`ALTER TABLE\\s+${table}[\\s\\S]*?reorganization_id`, 'i'),
      );
    }
  });

  it('uses created_at as recorded_from and never infers effective dates from modified_at', () => {
    expect(sql).toMatch(/recorded_from\s*=\s*created_at/i);
    expect(sql).not.toMatch(/valid_from\s*=\s*.*modified_at/i);
    expect(sql).not.toMatch(/valid_to\s*=\s*.*modified_at/i);
  });

  it('requires XOR typed foreign keys for name versions and participants', () => {
    expect(sql).toMatch(
      /institutional_name_versions[\s\S]*?CHECK\s*\([\s\S]*?division_id[\s\S]*?union_id[\s\S]*?local_field_id[\s\S]*?districlub_type_id[\s\S]*?church_id[\s\S]*?club_id[\s\S]*?\)/i,
    );
    expect(sql).toMatch(
      /institutional_reorganization_participants[\s\S]*?CHECK\s*\([\s\S]*?division_id[\s\S]*?union_id[\s\S]*?local_field_id[\s\S]*?districlub_type_id[\s\S]*?church_id[\s\S]*?club_id[\s\S]*?\)/i,
    );
  });

  it('indexes a single open revision using recorded_to IS NULL', () => {
    expect(sql).toMatch(
      /CREATE UNIQUE INDEX[\s\S]*?WHERE\s+recorded_to\s+IS\s+NULL\s+AND\s+valid_to\s+IS\s+NULL/i,
    );
  });

  it('scopes overlap exclusions to currently recorded revisions only', () => {
    expect(sql).toMatch(
      /EXCLUDE USING gist[\s\S]*?WHERE\s*\(\s*recorded_to\s+IS\s+NULL\s*\)/i,
    );
  });

  it('protects applied reorganizations, participants and lineage as append-only', () => {
    expect(sql).toMatch(
      /CREATE TRIGGER[\s\S]*institutional_reorganizations[\s\S]*UPDATE\s+OR\s+DELETE/i,
    );
    expect(sql).toMatch(
      /CREATE TRIGGER[\s\S]*institutional_reorganization_participants[\s\S]*UPDATE\s+OR\s+DELETE/i,
    );
    expect(sql).toMatch(
      /CREATE TRIGGER[\s\S]*institutional_lineage_edges[\s\S]*UPDATE\s+OR\s+DELETE/i,
    );
  });

  it('does not invent evidence or document reference columns', () => {
    expect(sql).not.toMatch(/\bevidence\b/i);
    expect(sql).not.toMatch(/\battachment\b/i);
    expect(sql).not.toMatch(/\bresolution_number\b/i);
    expect(sql).not.toMatch(/\bdocument_reference\b/i);
  });
});
