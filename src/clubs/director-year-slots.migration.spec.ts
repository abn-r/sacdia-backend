import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Unit test — no DB required.
 *
 * Asserts that the year-aware trigger function added in
 * 20260908180000_director_year_slots/migration.sql:
 *   1. Filters both the peak-count query and the exclusivity EXISTS by
 *      `cra.ecclesiastical_year_id = NEW.ecclesiastical_year_id`
 *   2. Declares the trigger with UPDATE OF including `ecclesiastical_year_id`
 *      so year-only PATCHes re-check the slot.
 */

const migration = readFileSync(
  join(
    __dirname,
    '../../prisma/migrations/20260908180000_director_year_slots/migration.sql',
  ),
  'utf8',
);

describe('director-year-slots migration (20260908180000)', () => {
  it('trigger function scopes peak-count query to ecclesiastical_year_id', () => {
    // The peak-count CTE WHERE must include the year filter.
    // We count occurrences to ensure both the peak section and the exclusivity
    // section carry the filter (at least 2 independent occurrences).
    const matches = migration.match(
      /cra\.ecclesiastical_year_id\s*=\s*NEW\.ecclesiastical_year_id/g,
    );
    expect(matches).not.toBeNull();
    expect(matches!.length).toBeGreaterThanOrEqual(2);
  });

  it('trigger UPDATE OF clause includes ecclesiastical_year_id', () => {
    expect(migration).toMatch(
      /UPDATE\s+OF\s+[^;]*ecclesiastical_year_id/,
    );
  });

  it('CREATE OR REPLACE FUNCTION enforce_club_role_slot_limits is present', () => {
    expect(migration).toMatch(
      /CREATE\s+OR\s+REPLACE\s+FUNCTION\s+enforce_club_role_slot_limits/,
    );
  });

  it('trigger is recreated with DROP TRIGGER before CREATE TRIGGER', () => {
    const dropIdx = migration.indexOf('DROP TRIGGER IF EXISTS trg_enforce_club_role_slot_limits');
    const createIdx = migration.indexOf('CREATE TRIGGER trg_enforce_club_role_slot_limits');
    expect(dropIdx).toBeGreaterThan(-1);
    expect(createIdx).toBeGreaterThan(dropIdx);
  });
});
