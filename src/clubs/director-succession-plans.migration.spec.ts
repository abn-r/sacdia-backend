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
    '20260730160000_director_succession_plans',
    'migration.sql',
  ),
  'utf8',
);
const databaseUrl = process.env.AUTHORIZATION_P0_INTEGRATION_DATABASE_URL;
const dbIt =
  process.env.ALLOW_AUTHORIZATION_P0_INTEGRATION_DB === '1' && databaseUrl
    ? it
    : it.skip;

describe('director succession plan migration', () => {
  dbIt(
    'enforces the derived, idempotent, restricted plan contract',
    async () => {
      if (!databaseUrl) throw new Error('integration URL required');
      const schema = `be03_plan_${randomBytes(6).toString('hex')}`;
      const client = new Client({ connectionString: databaseUrl });
      await client.connect();
      try {
        await client.query(`CREATE SCHEMA ${schema}; SET search_path=${schema},public;
        CREATE TABLE users (user_id uuid PRIMARY KEY);
        CREATE TABLE local_fields (local_field_id int PRIMARY KEY);
        CREATE TABLE club_sections (club_section_id int PRIMARY KEY);
        CREATE TABLE ecclesiastical_years (year_id int PRIMARY KEY, start_date date NOT NULL);
        CREATE TABLE club_role_assignments (assignment_id uuid PRIMARY KEY);
        INSERT INTO users VALUES ('00000000-0000-0000-0000-000000000001'), ('00000000-0000-0000-0000-000000000002'), ('00000000-0000-0000-0000-000000000003');
        INSERT INTO local_fields VALUES (1); INSERT INTO club_sections VALUES (1), (2);
        INSERT INTO ecclesiastical_years VALUES (1, '2027-01-01'), (2, '2028-01-01');
        INSERT INTO club_role_assignments VALUES ('30000000-0000-0000-0000-000000000001');`);
        await client.query(`SET search_path=${schema},public; ${migration}`);
        const plan = `INSERT INTO director_succession_plans (succession_id, club_section_id, outgoing_assignment_id, successor_user_id, target_ecclesiastical_year_id, effective_date, scheduled_by_id, scheduled_by_role, scheduled_local_field_id, idempotency_key, request_hash) VALUES ('20000000-0000-0000-0000-000000000001', 1, '30000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000002', 1, '2000-01-01', '00000000-0000-0000-0000-000000000001', 'director-lf', 1, 'key-1', repeat('a', 64))`;
        await expect(client.query(plan)).resolves.toBeDefined();
        await expect(
          client.query('SELECT effective_date FROM director_succession_plans'),
        ).resolves.toMatchObject({ rows: [{ effective_date: '2027-01-01' }] });
        await expect(
          client.query(
            "UPDATE director_succession_plans SET effective_date = '2000-01-01'",
          ),
        ).resolves.toBeDefined();
        await expect(
          client.query('SELECT effective_date FROM director_succession_plans'),
        ).resolves.toMatchObject({ rows: [{ effective_date: '2027-01-01' }] });
        await expect(
          client.query(plan.replace('key-1', 'key-2')),
        ).rejects.toMatchObject({ code: '23505' });
        await expect(
          client.query(
            plan
              .replace(
                "'20000000-0000-0000-0000-000000000001'",
                "'20000000-0000-0000-0000-000000000002'",
              )
              .replace(", 1, '300", ", 2, '300")
              .replace(", 1, '2000", ", 2, '2000")
              .replace("repeat('a', 64)", "repeat('b', 64)"),
          ),
        ).rejects.toMatchObject({ code: '23505' });
        await expect(
          client.query(
            "UPDATE director_succession_plans SET status = 'blocked' WHERE succession_id = '20000000-0000-0000-0000-000000000001'",
          ),
        ).rejects.toMatchObject({ code: '23514' });
        await expect(
          client.query('DELETE FROM ecclesiastical_years WHERE year_id = 1'),
        ).rejects.toMatchObject({ code: '23503' });
        await expect(
          client.query('DELETE FROM club_sections WHERE club_section_id = 1'),
        ).rejects.toMatchObject({ code: '23503' });
        await expect(
          client.query(
            "DELETE FROM users WHERE user_id = '00000000-0000-0000-0000-000000000002'",
          ),
        ).rejects.toMatchObject({ code: '23503' });
        await expect(
          client.query(
            "DELETE FROM club_role_assignments WHERE assignment_id = '30000000-0000-0000-0000-000000000001'",
          ),
        ).rejects.toMatchObject({ code: '23503' });
      } finally {
        await client.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
        await client.end();
      }
    },
  );
});
