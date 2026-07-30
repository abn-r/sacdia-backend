import { randomBytes } from 'node:crypto';
import { Client } from 'pg';
import {
  applyLocalFieldTimezoneBackfill,
  parseTimezoneMapping,
  TimezoneBackfillError,
} from './backfill-local-field-timezones';
import { loadCanonicalGeographicIanaTimezoneCatalog } from '../src/common/timezone/canonical-geographic-iana-timezone';

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
  });

  dbIt('is dry-run safe, applies only drift, and is idempotent', async () => {
    if (!databaseUrl) throw new Error('integration URL required');
    const schema = `be04a_${randomBytes(6).toString('hex')}`;
    const client = new Client({ connectionString: databaseUrl });
    await client.connect();
    try {
      await client.query(`CREATE SCHEMA ${schema}; SET search_path=${schema},public;
        CREATE TABLE local_fields (local_field_id int PRIMARY KEY, name text, active boolean, timezone text, modified_at timestamptz);
        CREATE TABLE classes (class_id int PRIMARY KEY, asset_code text);
        CREATE TABLE authorization_context_versions (user_id uuid PRIMARY KEY, version bigint, modified_at timestamptz);
        CREATE TABLE clubs (club_id int PRIMARY KEY, local_field_id int); CREATE TABLE club_sections (club_section_id int PRIMARY KEY, main_club_id int);
        CREATE TABLE club_role_assignments (assignment_id uuid PRIMARY KEY, user_id uuid, club_section_id int);
        CREATE TABLE director_succession_plans (status text, scheduled_local_field_id int, version int, processing_token uuid, processing_expires_at timestamptz, modified_at timestamptz);
        INSERT INTO local_fields VALUES (1,'Norte',true,NULL,NULL),(2,'Sur',true,'America/Cancun',NULL),(3,'Inactivo',false,NULL,NULL);
        INSERT INTO classes VALUES (1,'GM-01'); INSERT INTO clubs VALUES(1,1); INSERT INTO club_sections VALUES(1,1);
        INSERT INTO club_role_assignments VALUES('00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000010',1);
        INSERT INTO director_succession_plans VALUES('scheduled',1,1,'00000000-0000-0000-0000-000000000011',now(),NULL);`);
      const mapping = new Map([
        [1, 'America/Tijuana'],
        [2, 'America/Cancun'],
      ]);
      await expect(
        applyLocalFieldTimezoneBackfill(
          client,
          new Map([[1, 'America/Tijuana']]),
          false,
        ),
      ).rejects.toMatchObject({ code: 'BACKFILL_MAPPING_INCOMPLETE' });
      await expect(
        applyLocalFieldTimezoneBackfill(client, mapping, false),
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
      await applyLocalFieldTimezoneBackfill(client, mapping, true);
      await expect(
        client.query(
          'SELECT timezone FROM local_fields WHERE local_field_id=1',
        ),
      ).resolves.toMatchObject({ rows: [{ timezone: 'America/Tijuana' }] });
      await expect(
        client.query('SELECT version FROM authorization_context_versions'),
      ).resolves.toMatchObject({ rows: [{ version: '1' }] });
      await expect(
        client.query(`SELECT version, processing_token, processing_expires_at
          FROM director_succession_plans`),
      ).resolves.toMatchObject({
        rows: [
          { version: 2, processing_token: null, processing_expires_at: null },
        ],
      });
      await expect(
        applyLocalFieldTimezoneBackfill(client, mapping, true),
      ).resolves.toMatchObject({
        fields: [{ operation: 'unchanged' }, { operation: 'unchanged' }],
      });
      await client.query(`DELETE FROM classes WHERE asset_code = 'GM-01'`);
      await expect(
        applyLocalFieldTimezoneBackfill(client, mapping, false),
      ).rejects.toMatchObject({ code: 'BACKFILL_GM_01_CARDINALITY_INVALID' });
    } finally {
      await client.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
      await client.end();
    }
  });
});
