import { randomBytes } from 'node:crypto';
import { Client } from 'pg';
import {
  planLocalFieldTimezoneBackfill,
  parseBackfillOptions,
  parseTimezoneMapping,
  verifyBackfillPreflight,
  TimezoneBackfillError,
} from '../../scripts/backfill-local-field-timezones';
import { loadCanonicalGeographicIanaTimezoneCatalog } from './timezone/canonical-geographic-iana-timezone';

const databaseUrl = process.env.AUTHORIZATION_P0_INTEGRATION_DATABASE_URL;
const dbIt =
  process.env.ALLOW_AUTHORIZATION_P0_INTEGRATION_DB === '1' && databaseUrl
    ? it
    : it.skip;

describe('local field timezone backfill', () => {
  it('accepts only an explicit canonical local-field mapping', () => {
    const catalog = loadCanonicalGeographicIanaTimezoneCatalog();
    expect(parseTimezoneMapping('{"2":"America/Cancun"}', catalog)).toEqual(
      new Map([[2, 'America/Cancun']]),
    );
    expect(() => parseTimezoneMapping('{"2":"US/Eastern"}', catalog)).toThrow(
      TimezoneBackfillError,
    );
    expect(() =>
      parseBackfillOptions(['--mapping', 'mapping.json', '--apply']),
    ).toThrow('BACKFILL_APPLY_REQUIRES_BE04A2');
  });

  dbIt('validates the complete mapping and GM-01 without writing', async () => {
    if (!databaseUrl) throw new Error('integration URL required');
    const schema = `be04a_${randomBytes(6).toString('hex')}`;
    const client = new Client({ connectionString: databaseUrl });
    await client.connect();
    try {
      await client.query(`CREATE SCHEMA ${schema}; SET search_path=${schema},public;
        CREATE TABLE local_fields (local_field_id int PRIMARY KEY, name text, union_id int, active boolean, timezone text);
        CREATE TABLE classes (class_id int PRIMARY KEY, asset_code text);
        INSERT INTO local_fields VALUES (1,'Norte',1,true,NULL),(2,'Sur',1,true,'America/Cancun');
        INSERT INTO classes VALUES (1,'GM-01');`);
      const mapping = new Map([
        [1, 'America/Tijuana'],
        [2, 'America/Cancun'],
      ]);
      await expect(
        planLocalFieldTimezoneBackfill(client, mapping),
      ).rejects.toMatchObject({
        code: 'BACKFILL_SCHEMA_NOT_READY',
      });
      await client.query(`CREATE TABLE authorization_context_versions (user_id uuid PRIMARY KEY, version bigint, modified_at timestamptz);
        CREATE TABLE director_succession_plans (club_section_id int, status text);
        CREATE TABLE clubs (club_id int, local_field_id int);
        CREATE TABLE club_sections (club_section_id int, main_club_id int);
        CREATE TABLE club_role_assignments (assignment_id uuid, user_id uuid, role_id uuid, ecclesiastical_year_id int, start_date date, end_date date, active boolean, status text, expires_at timestamptz, club_section_id int);
        CREATE TABLE roles (role_id uuid, role_name text, role_category text);
        CREATE TABLE ecclesiastical_years (year_id int, start_date date, end_date date);
        CREATE TABLE users_pr (user_id uuid, active_club_assignment_id uuid);
        CREATE TABLE audit_logs (audit_log_id bigint, action text);`);
      await expect(
        planLocalFieldTimezoneBackfill(
          client,
          new Map([[1, 'America/Tijuana']]),
        ),
      ).rejects.toMatchObject({ code: 'BACKFILL_MAPPING_INCOMPLETE' });
      await expect(
        planLocalFieldTimezoneBackfill(
          client,
          new Map([
            [1, 'America/Tijuana'],
            [2, 'America/Cancun'],
            [7, 'America/Mazatlan'],
          ]),
        ),
      ).rejects.toMatchObject({ code: 'BACKFILL_MAPPING_UNKNOWN_LOCAL_FIELD' });
      await expect(
        planLocalFieldTimezoneBackfill(client, mapping),
      ).resolves.toMatchObject({
        fields: [
          { local_field_id: 1, operation: 'update' },
          { local_field_id: 2, operation: 'unchanged' },
        ],
      });
      await expect(
        client.query(
          'SELECT timezone FROM local_fields WHERE local_field_id=1',
        ),
      ).resolves.toMatchObject({ rows: [{ timezone: null }] });
      await expect(
        verifyBackfillPreflight(
          client,
          loadCanonicalGeographicIanaTimezoneCatalog(),
        ),
      ).resolves.toMatchObject({
        schema: {
          local_fields_timezone: 'ready',
          director_succession_plans: 'ready',
        },
        checks: [
          expect.objectContaining({
            id: 'local_field_timezones',
            total_count: 1,
            rows: [
              expect.objectContaining({ local_field_id: 1, reason: 'MISSING' }),
            ],
          }),
        ],
      });
      await client.query(
        `DELETE FROM classes WHERE asset_code = 'GM-01'; INSERT INTO classes VALUES(2,'GM-01'),(3,'GM-01');`,
      );
      await expect(
        planLocalFieldTimezoneBackfill(client, mapping),
      ).rejects.toMatchObject({
        code: 'BACKFILL_GM_01_CARDINALITY_INVALID',
      });
    } finally {
      await client.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
      await client.end();
    }
  });
});
