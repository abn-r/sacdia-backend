import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Client } from 'pg';

const migration = readFileSync(
  join(
    __dirname,
    '..',
    '..',
    'prisma',
    'migrations',
    '20260730150000_authorization_temporal_context',
    'migration.sql',
  ),
  'utf8',
);
const databaseUrl = process.env.AUTHORIZATION_P0_INTEGRATION_DATABASE_URL;
const dbIt =
  process.env.ALLOW_AUTHORIZATION_P0_INTEGRATION_DB === '1' && databaseUrl
    ? it
    : it.skip;

describe('authorization temporal context migration', () => {
  dbIt('preserves legacy active rows while enforcing timezone writes', async () => {
    if (!databaseUrl) throw new Error('integration URL required');
    const schema = `be02_timezone_${randomBytes(6).toString('hex')}`;
    const client = new Client({ connectionString: databaseUrl });
    await client.connect();

    try {
      await client.query(`CREATE SCHEMA ${schema}; SET search_path=${schema},public;
        CREATE TABLE users (user_id uuid PRIMARY KEY);
        CREATE TABLE local_fields (
          local_field_id int PRIMARY KEY, name text, union_id int, active boolean
        );
        INSERT INTO local_fields VALUES (1, 'Legacy', 1, true);`);
      await client.query(`SET search_path=${schema},public; ${migration}`);

      await expect(
        client.query('SELECT timezone FROM local_fields WHERE local_field_id = 1'),
      ).resolves.toMatchObject({ rows: [{ timezone: null }] });
      await expect(
        client.query(
          `SELECT convalidated FROM pg_constraint
           WHERE conname = 'local_fields_active_timezone_required'`,
        ),
      ).resolves.toMatchObject({ rows: [{ convalidated: false }] });
      await expect(
        client.query(
          "INSERT INTO local_fields VALUES (2, 'Invalid', 1, true, NULL)",
        ),
      ).rejects.toMatchObject({ code: '23514' });
      await expect(
        client.query("UPDATE local_fields SET name = 'Changed' WHERE local_field_id = 1"),
      ).rejects.toMatchObject({ code: '23514' });
      await expect(
        client.query(
          "INSERT INTO local_fields VALUES (3, 'Inactive', 1, false, NULL)",
        ),
      ).resolves.toBeDefined();
    } finally {
      await client.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
      await client.end();
    }
  });
});
