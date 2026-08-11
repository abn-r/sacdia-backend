import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Prisma } from '@prisma/client';

const MIGRATION_PATH = join(
  process.cwd(),
  'prisma/migrations/20260811180000_configurable_certifications_engine/migration.sql',
);

function readMigration(): string {
  return readFileSync(MIGRATION_PATH, 'utf8');
}

function modelByName(name: string) {
  return Prisma.dmmf.datamodel.models.find((model) => model.name === name);
}

describe('configurable certifications schema', () => {
  let sql: string;

  beforeAll(() => {
    sql = readMigration();
  });

  it('exposes versioned definition and execution models', () => {
    const modelNames = Prisma.dmmf.datamodel.models.map((model) => model.name);

    expect(modelNames).toEqual(
      expect.arrayContaining([
        'certifications',
        'certification_versions',
        'certification_eligibility_rules',
        'certification_modules',
        'certification_sections',
        'certification_requirement_components',
        'users_certifications',
        'certification_section_progress',
        'certification_component_responses',
        'certification_evidences',
        'certification_review_events',
        'certification_closeout_evidences',
        'certification_module_progress',
      ]),
    );
  });

  it('uses domain enums for version, enrollment, requirement and component types', () => {
    const version = modelByName('certification_versions');
    const enrollment = modelByName('users_certifications');
    const progress = modelByName('certification_section_progress');
    const component = modelByName('certification_requirement_components');
    const eligibility = modelByName('certification_eligibility_rules');

    expect(version?.fields).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: 'status',
          type: 'certification_version_status_enum',
        }),
      ]),
    );
    expect(enrollment?.fields).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: 'status',
          type: 'certification_enrollment_status_enum',
        }),
        expect.objectContaining({ name: 'certification_version_id' }),
        expect.objectContaining({ name: 'lock_version' }),
      ]),
    );
    expect(progress?.fields).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: 'status',
          type: 'certification_requirement_status_enum',
        }),
        expect.objectContaining({ name: 'enrollment_id' }),
      ]),
    );
    expect(component?.fields).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: 'component_type',
          type: 'certification_component_type_enum',
        }),
      ]),
    );
    expect(eligibility?.fields).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: 'rule_type',
          type: 'certification_eligibility_rule_type_enum',
        }),
      ]),
    );
  });

  it('keeps modules bound to a version and requirements ordered', () => {
    const modules = modelByName('certification_modules');
    const sections = modelByName('certification_sections');

    expect(modules?.fields).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'certification_version_id' }),
        expect.objectContaining({ name: 'sort_order' }),
      ]),
    );
    expect(sections?.fields).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'sort_order' }),
        expect.objectContaining({ name: 'required' }),
        expect.objectContaining({ name: 'instructions' }),
      ]),
    );
  });

  it('creates migration tables, enums and enrollment FKs', () => {
    expect(sql).toMatch(/CREATE TYPE\s+certification_version_status_enum/i);
    expect(sql).toMatch(/CREATE TYPE\s+certification_enrollment_status_enum/i);
    expect(sql).toMatch(/CREATE TYPE\s+certification_requirement_status_enum/i);
    expect(sql).toMatch(/CREATE TYPE\s+certification_component_type_enum/i);
    expect(sql).toMatch(
      /CREATE TYPE\s+certification_eligibility_rule_type_enum/i,
    );

    expect(sql).toMatch(
      /CREATE TABLE(?:\s+IF NOT EXISTS)?\s+"?certification_versions"?/i,
    );
    expect(sql).toMatch(
      /CREATE TABLE(?:\s+IF NOT EXISTS)?\s+"?certification_eligibility_rules"?/i,
    );
    expect(sql).toMatch(
      /CREATE TABLE(?:\s+IF NOT EXISTS)?\s+"?certification_requirement_components"?/i,
    );
    expect(sql).toMatch(
      /CREATE TABLE(?:\s+IF NOT EXISTS)?\s+"?certification_component_responses"?/i,
    );
    expect(sql).toMatch(
      /CREATE TABLE(?:\s+IF NOT EXISTS)?\s+"?certification_evidences"?/i,
    );
    expect(sql).toMatch(
      /CREATE TABLE(?:\s+IF NOT EXISTS)?\s+"?certification_review_events"?/i,
    );
    expect(sql).toMatch(
      /CREATE TABLE(?:\s+IF NOT EXISTS)?\s+"?certification_closeout_evidences"?/i,
    );

    expect(sql).toMatch(
      /FOREIGN KEY\s*\(\s*"?certification_version_id"?\s*\)/i,
    );
    expect(sql).toMatch(/FOREIGN KEY\s*\(\s*"?enrollment_id"?\s*\)/i);
  });

  it('backfills published version 1 and binds enrollments without dropping legacy columns', () => {
    expect(sql).toMatch(/INSERT INTO\s+"?certification_versions"?/i);
    expect(sql).toMatch(/"version_number"/i);
    expect(sql).toMatch(/"status"/i);
    expect(sql).toMatch(/'PUBLISHED'/i);
    expect(sql).toMatch(
      /UPDATE\s+"?users_certifications"?[\s\S]*certification_version_id/i,
    );
    expect(sql).not.toMatch(
      /DROP TABLE\s+"?certification_module_progress"?/i,
    );
    expect(sql).not.toMatch(/DROP COLUMN\s+"?completion_status"?/i);
  });

  it('indexes review trays and active enrollment uniqueness', () => {
    expect(sql).toMatch(
      /CREATE UNIQUE INDEX[\s\S]*users_certifications[\s\S]*WHERE/i,
    );
    expect(sql).toMatch(
      /CREATE INDEX[\s\S]*certification_section_progress[\s\S]*status/i,
    );
    expect(sql).toMatch(
      /CREATE INDEX[\s\S]*users_certifications[\s\S]*status/i,
    );
  });

  it('keeps review history without cascade delete', () => {
    const reviewCreate = sql.match(
      /CREATE TABLE(?:\s+IF NOT EXISTS)?\s+"?certification_review_events"?\s*\([\s\S]*?\);/i,
    )?.[0];

    expect(reviewCreate).toBeDefined();
    expect(reviewCreate).not.toMatch(/ON DELETE\s+CASCADE/i);
    expect(reviewCreate).toMatch(/ON DELETE\s+(NO ACTION|RESTRICT)/i);
  });
});
