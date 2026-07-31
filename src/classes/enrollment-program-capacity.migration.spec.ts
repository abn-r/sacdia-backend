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
    '20260731070000_enrollment_program_capacity',
    'migration.sql',
  ),
  'utf8',
);
const databaseUrl = process.env.AUTHORIZATION_P0_INTEGRATION_DATABASE_URL;
const dbIt =
  process.env.ALLOW_AUTHORIZATION_P0_INTEGRATION_DB === '1' && databaseUrl
    ? it
    : it.skip;
const userA = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11';
const userB = 'b0eebc99-9c0b-4ef8-bb6d-6bb9bd380a22';

const fixtures = (schema: string) => `
  CREATE SCHEMA ${schema}; SET search_path=${schema},public;
  CREATE TYPE formative_program_type_enum AS ENUM ('STANDARD', 'GUIDE_MAJOR');
  CREATE TABLE classes (
    class_id integer PRIMARY KEY, club_type_id integer NOT NULL,
    formative_program_type formative_program_type_enum NOT NULL DEFAULT 'STANDARD'
  );
  CREATE TABLE enrollments (
    enrollment_id integer PRIMARY KEY, user_id uuid NOT NULL,
    class_id integer NOT NULL REFERENCES classes(class_id),
    ecclesiastical_year_id integer NOT NULL, active boolean NOT NULL DEFAULT true,
    UNIQUE (user_id, class_id, ecclesiastical_year_id)
  );
  CREATE UNIQUE INDEX uniq_enrollments_active_user_year
    ON enrollments (user_id, ecclesiastical_year_id) WHERE active = true;
  INSERT INTO classes VALUES
    (1, 1, 'STANDARD'), (2, 2, 'STANDARD'),
    (3, 3, 'GUIDE_MAJOR'), (4, 3, 'GUIDE_MAJOR'), (5, 3, 'GUIDE_MAJOR');
`;
const insert = (id: number, userId: string, classId: number, active = true) =>
  `INSERT INTO enrollments VALUES (${id}, '${userId}', ${classId}, 2027, ${active})`;

describe('enrollment program capacity migration', () => {
  dbIt('enforces canonical capacities and remains idempotent', async () => {
    if (!databaseUrl) throw new Error('integration URL required');
    const schema = `enrollment_capacity_${randomBytes(6).toString('hex')}`;
    const client = new Client({ connectionString: databaseUrl });
    await client.connect();
    try {
      await client.query(fixtures(schema));
      await client.query(migration);

      await expect(client.query(insert(1, userA, 3))).resolves.toBeDefined();
      await expect(client.query(insert(2, userA, 4))).resolves.toBeDefined();
      await expect(client.query(insert(3, userA, 5))).rejects.toMatchObject({
        code: '23514',
        constraint: 'enrollments_active_program_capacity_check',
      });
      await expect(client.query(insert(6, userA, 1))).resolves.toBeDefined();
      await expect(client.query(insert(4, userB, 1))).resolves.toBeDefined();
      await expect(client.query(insert(5, userB, 2))).rejects.toMatchObject({
        code: '23514',
        constraint: 'enrollments_active_program_capacity_check',
      });
      await expect(
        client.query(insert(5, userB, 2, false)),
      ).resolves.toBeDefined();
      await expect(
        client.query(
          'UPDATE enrollments SET active=true WHERE enrollment_id=5',
        ),
      ).rejects.toMatchObject({
        code: '23514',
        constraint: 'enrollments_active_program_capacity_check',
      });
      await expect(
        client.query(
          "UPDATE classes SET formative_program_type='GUIDE_MAJOR' WHERE class_id=1",
        ),
      ).rejects.toMatchObject({
        code: '23514',
        constraint: 'classes_formative_program_type_immutable_check',
      });
      await expect(client.query(migration)).resolves.toBeDefined();
    } finally {
      await client.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
      await client.end();
    }
  });

  dbIt('serializes concurrent writes at the GUIDE_MAJOR limit', async () => {
    if (!databaseUrl) throw new Error('integration URL required');
    const schema = `enrollment_capacity_race_${randomBytes(6).toString('hex')}`;
    const first = new Client({ connectionString: databaseUrl });
    const second = new Client({ connectionString: databaseUrl });
    await Promise.all([first.connect(), second.connect()]);
    try {
      await first.query(fixtures(schema));
      await first.query(migration);
      await first.query(insert(1, userA, 3));
      await Promise.all([
        first.query(`SET search_path=${schema},public; BEGIN`),
        second.query(`SET search_path=${schema},public; BEGIN`),
      ]);
      await first.query(insert(2, userA, 4));
      let settled = false;
      const competing = second
        .query(insert(3, userA, 5))
        .finally(() => (settled = true));
      await new Promise((resolve) => setTimeout(resolve, 100));
      expect(settled).toBe(false);
      await first.query('COMMIT');
      await expect(competing).rejects.toMatchObject({
        code: '23514',
        constraint: 'enrollments_active_program_capacity_check',
      });
      await second.query('ROLLBACK');
      await expect(
        first.query(
          'SELECT count(*)::int AS count FROM enrollments WHERE active=true',
        ),
      ).resolves.toMatchObject({ rows: [{ count: 2 }] });
    } finally {
      await Promise.allSettled([
        first.query('ROLLBACK'),
        second.query('ROLLBACK'),
      ]);
      await first.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
      await Promise.allSettled([first.end(), second.end()]);
    }
  });

  dbIt(
    'aborts incompatible legacy data and rolls back failed DDL',
    async () => {
      if (!databaseUrl) throw new Error('integration URL required');
      for (const rollbackProbe of [false, true]) {
        const schema = `enrollment_capacity_guard_${randomBytes(6).toString('hex')}`;
        const client = new Client({ connectionString: databaseUrl });
        await client.connect();
        try {
          await client.query(fixtures(schema));
          if (rollbackProbe) {
            await expect(
              client.query(
                migration.replace('COMMIT;', 'SELECT 1 / 0; COMMIT;'),
              ),
            ).rejects.toMatchObject({ code: '22012' });
            await client.query('ROLLBACK');
            await expect(
              client.query(`SELECT to_regclass('${schema}.uniq_enrollments_active_user_year') AS old_index,
              EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid='enrollments'::regclass
                AND tgname='trg_enforce_active_enrollment_capacity') AS capacity_trigger`),
            ).resolves.toMatchObject({
              rows: [
                {
                  old_index: 'uniq_enrollments_active_user_year',
                  capacity_trigger: false,
                },
              ],
            });
          } else {
            await client.query('DROP INDEX uniq_enrollments_active_user_year');
            await client.query(insert(1, userA, 3));
            await client.query(insert(2, userA, 4));
            await client.query(insert(3, userA, 5));
            await expect(client.query(migration)).rejects.toMatchObject({
              code: '23514',
              constraint: 'enrollments_active_program_capacity_preflight',
            });
            await client.query('ROLLBACK');
          }
        } finally {
          await client.query('ROLLBACK');
          await client.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
          await client.end();
        }
      }
    },
  );
});
