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
    '20260730170000_assignment_constraints_gm_identity',
    'migration.sql',
  ),
  'utf8',
);
const databaseUrl = process.env.AUTHORIZATION_P0_INTEGRATION_DATABASE_URL;
const dbIt =
  process.env.ALLOW_AUTHORIZATION_P0_INTEGRATION_DB === '1' && databaseUrl
    ? it
    : it.skip;

const fixtures = (schema: string) => `
  CREATE SCHEMA ${schema}; SET search_path=${schema},public;
  CREATE TABLE roles (role_id uuid PRIMARY KEY, role_name text NOT NULL, role_category text NOT NULL, active boolean NOT NULL DEFAULT true);
  CREATE TABLE role_slot_limits (role_id uuid PRIMARY KEY REFERENCES roles(role_id), max_per_section integer NOT NULL);
  CREATE TABLE club_sections (club_section_id integer PRIMARY KEY);
  CREATE TABLE club_role_assignments (
    assignment_id uuid PRIMARY KEY, user_id uuid NOT NULL, role_id uuid NOT NULL,
    ecclesiastical_year_id integer NOT NULL, start_date date NOT NULL, end_date date,
    active boolean NOT NULL DEFAULT true, status varchar(20) DEFAULT 'active', club_section_id integer
  );
  CREATE TABLE classes (class_id integer PRIMARY KEY, asset_code varchar(10));
  INSERT INTO club_sections VALUES (1);
  INSERT INTO roles VALUES
    ('10000000-0000-0000-0000-000000000001', 'director', 'CLUB', true),
    ('10000000-0000-0000-0000-000000000002', 'secretary', 'CLUB', true),
    ('10000000-0000-0000-0000-000000000003', 'secretary-treasurer', 'CLUB', true),
    ('10000000-0000-0000-0000-000000000004', 'treasurer', 'CLUB', true);
  INSERT INTO role_slot_limits VALUES
    ('10000000-0000-0000-0000-000000000001', 1),
    ('10000000-0000-0000-0000-000000000002', 1),
    ('10000000-0000-0000-0000-000000000003', 1),
    ('10000000-0000-0000-0000-000000000004', 1);
  INSERT INTO club_role_assignments VALUES
    ('20000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 1, '2027-02-01', '2027-01-01', true, 'active', 1);
`;

const assignment = (
  id: string,
  user: string,
  role: string,
  start: string,
  end: string | null,
  status = 'active',
) =>
  `INSERT INTO club_role_assignments VALUES ('${id}', '${user}', '${role}', 1, '${start}', ${end ? `'${end}'` : 'NULL'}, true, '${status}', 1)`;

describe('club role assignment constraints migration', () => {
  dbIt(
    'keeps legacy rows while enforcing date, overlap, slots, and nullable asset identity',
    async () => {
      if (!databaseUrl) throw new Error('integration URL required');
      const schema = `be03_assignments_${randomBytes(6).toString('hex')}`;
      const client = new Client({ connectionString: databaseUrl });
      await client.connect();
      try {
        await client.query(fixtures(schema));
        await client.query(`SET search_path=${schema},public; ${migration}`);

        await expect(
          client.query(
            "INSERT INTO classes VALUES (1, NULL), (2, NULL), (3, 'GM-01')",
          ),
        ).resolves.toBeDefined();
        await expect(
          client.query("INSERT INTO classes VALUES (4, 'GM-01')"),
        ).rejects.toMatchObject({
          code: '23505',
          constraint: 'classes_asset_code_key',
        });
        await expect(
          client.query(
            assignment(
              '20000000-0000-0000-0000-000000000002',
              '30000000-0000-0000-0000-000000000002',
              '10000000-0000-0000-0000-000000000001',
              '2027-03-01',
              '2027-02-01',
            ),
          ),
        ).rejects.toMatchObject({
          code: '23514',
          constraint: 'club_role_assignments_date_range_check',
        });
        await expect(
          client.query(
            "UPDATE club_role_assignments SET active = true WHERE assignment_id = '20000000-0000-0000-0000-000000000001'",
          ),
        ).rejects.toMatchObject({
          code: '23514',
          constraint: 'club_role_assignments_date_range_check',
        });

        await expect(
          client.query(
            assignment(
              '20000000-0000-0000-0000-000000000003',
              '30000000-0000-0000-0000-000000000003',
              '10000000-0000-0000-0000-000000000001',
              '2027-03-01',
              '2027-03-31',
            ),
          ),
        ).resolves.toBeDefined();
        await expect(
          client.query(
            assignment(
              '20000000-0000-0000-0000-000000000004',
              '30000000-0000-0000-0000-000000000004',
              '10000000-0000-0000-0000-000000000001',
              '2027-03-31',
              '2027-04-30',
            ),
          ),
        ).rejects.toMatchObject({ code: '23514' });
        await expect(
          client.query(
            assignment(
              '20000000-0000-0000-0000-000000000005',
              '30000000-0000-0000-0000-000000000005',
              '10000000-0000-0000-0000-000000000001',
              '2027-05-01',
              null,
            ),
          ),
        ).resolves.toBeDefined();
        await expect(
          client.query(
            assignment(
              '20000000-0000-0000-0000-000000000006',
              '30000000-0000-0000-0000-000000000006',
              '10000000-0000-0000-0000-000000000001',
              '2027-05-01',
              null,
              'pending',
            ),
          ),
        ).resolves.toBeDefined();

        await expect(
          client.query(
            assignment(
              '20000000-0000-0000-0000-000000000007',
              '30000000-0000-0000-0000-000000000007',
              '10000000-0000-0000-0000-000000000002',
              '2027-06-01',
              '2027-06-30',
            ),
          ),
        ).resolves.toBeDefined();
        await expect(
          client.query(
            assignment(
              '20000000-0000-0000-0000-000000000008',
              '30000000-0000-0000-0000-000000000008',
              '10000000-0000-0000-0000-000000000003',
              '2027-06-15',
              '2027-07-15',
            ),
          ),
        ).rejects.toMatchObject({ code: '23514' });
        await expect(
          client.query(
            assignment(
              '20000000-0000-0000-0000-000000000009',
              '30000000-0000-0000-0000-000000000009',
              '10000000-0000-0000-0000-000000000003',
              '2027-07-01',
              '2027-07-31',
            ),
          ),
        ).resolves.toBeDefined();
      } finally {
        await client.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
        await client.end();
      }
    },
  );

  dbIt(
    'serializes conflicting secretary and treasurer slots across concurrent transactions',
    async () => {
      if (!databaseUrl) throw new Error('integration URL required');
      const schema = `be03_slots_${randomBytes(6).toString('hex')}`;
      const first = new Client({ connectionString: databaseUrl });
      const second = new Client({ connectionString: databaseUrl });
      await Promise.all([first.connect(), second.connect()]);
      try {
        await first.query(fixtures(schema));
        await first.query(`SET search_path=${schema},public; ${migration}`);
        for (const [roleId, startDate, winnerId, loserId] of [
          [
            '10000000-0000-0000-0000-000000000002',
            '2027-08-01',
            '20000000-0000-0000-0000-000000000010',
            '20000000-0000-0000-0000-000000000011',
          ],
          [
            '10000000-0000-0000-0000-000000000004',
            '2027-09-01',
            '20000000-0000-0000-0000-000000000012',
            '20000000-0000-0000-0000-000000000013',
          ],
        ] as const) {
          await Promise.all([
            first.query(`SET search_path=${schema},public; BEGIN`),
            second.query(`SET search_path=${schema},public; BEGIN`),
          ]);
          await first.query(
            assignment(
              winnerId,
              '30000000-0000-0000-0000-000000000010',
              roleId,
              startDate,
              `${startDate.slice(0, 7)}-28`,
            ),
          );
          const conflictingInsert = second.query(
            assignment(
              loserId,
              '30000000-0000-0000-0000-000000000011',
              '10000000-0000-0000-0000-000000000003',
              startDate,
              `${startDate.slice(0, 7)}-28`,
            ),
          );
          await first.query('COMMIT');
          await expect(conflictingInsert).rejects.toMatchObject({
            code: '23514',
          });
          await second.query('ROLLBACK');
        }
      } finally {
        await Promise.all([
          first.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`),
          second.query('ROLLBACK'),
        ]);
        await Promise.all([first.end(), second.end()]);
      }
    },
  );
});
