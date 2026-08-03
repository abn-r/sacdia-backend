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
const claimCount = (client: Client) => client.query('SELECT count(*)::int AS count FROM enrollment_program_capacity_claims');
const capacityError = { code: '23514', constraint: 'enrollments_active_program_capacity_check', detail: 'SACDIA_ENROLLMENT_PROGRAM_CAPACITY' };
const waitForLock = async (client: Client, applicationName: string) => {
  for (let attempt = 0; attempt < 100; attempt++) {
    const { rows } = await client.query('SELECT wait_event_type FROM pg_stat_activity WHERE application_name=$1', [applicationName]);
    if (rows[0]?.wait_event_type === 'Lock') return;
  }
  throw new Error(`${applicationName} never waited on a lock`);
};

describe('enrollment program capacity migration', () => {
  dbIt('materializes slots and synchronizes every active enrollment lifecycle', async () => {
    const schema = `enrollment_capacity_${randomBytes(6).toString('hex')}`;
    const client = new Client({ connectionString: databaseUrl }); await client.connect();
    try {
      await client.query(fixtures(schema)); await client.query(migration);
      await client.query(insert(1, userA, 3)); await client.query(insert(2, userA, 4));
      await client.query('UPDATE enrollments SET class_id=5 WHERE enrollment_id=2');
      await expect(client.query(insert(3, userA, 4))).rejects.toMatchObject(capacityError);
      await client.query(insert(4, userA, 1));
      await expect(client.query(insert(5, userA, 2))).rejects.toMatchObject(capacityError);
      await client.query(insert(5, userA, 2, false));
      await client.query('UPDATE enrollments SET active=false WHERE enrollment_id=4');
      await client.query('UPDATE enrollments SET active=true WHERE enrollment_id=5');
      await expect(client.query('UPDATE enrollments SET active=true WHERE enrollment_id=4')).rejects.toMatchObject(capacityError);
      await client.query('DELETE FROM enrollments WHERE enrollment_id=5');
      await expect(claimCount(client)).resolves.toMatchObject({ rows: [{ count: 2 }] });
      await expect(client.query("UPDATE classes SET formative_program_type='GUIDE_MAJOR' WHERE class_id=1"))
        .rejects.toMatchObject({ code: '23514', constraint: 'classes_formative_program_type_immutable_check' });
      await expect(client.query(migration)).resolves.toBeDefined();
    } finally { await client.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`); await client.end(); }
  });

  dbIt('backfills valid claims and rejects incompatible legacy capacity data', async () => {
    const schema = `enrollment_backfill_${randomBytes(6).toString('hex')}`;
    const client = new Client({ connectionString: databaseUrl }); await client.connect();
    try {
      await client.query(fixtures(schema)); await client.query('DROP INDEX uniq_enrollments_active_user_year');
      await client.query(insert(1, userA, 3)); await client.query(insert(2, userA, 4)); await client.query(migration);
      await expect(claimCount(client)).resolves.toMatchObject({ rows: [{ count: 2 }] });
      await client.query(`DROP SCHEMA ${schema} CASCADE`); await client.query(fixtures(schema));
      await client.query('DROP INDEX uniq_enrollments_active_user_year');
      await client.query(insert(1, userA, 3)); await client.query(insert(2, userA, 4)); await client.query(insert(3, userA, 5));
      await expect(client.query(migration)).rejects.toMatchObject({ code: '23514', constraint: 'enrollments_active_program_capacity_preflight' });
      await client.query('ROLLBACK');
      await expect(client.query(`SELECT to_regclass('${schema}.enrollment_program_capacity_claims') IS NULL AS claims_rolled_back`))
        .resolves.toMatchObject({ rows: [{ claims_rolled_back: true }] });
    } finally { await client.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`); await client.end(); }
  });

  dbIt('uses qualified claims despite pg_temp hijacks and reports capacity after a repeatable-read race', async () => {
    const schema = `enrollment_race_${randomBytes(6).toString('hex')}`;
    const first = new Client({ connectionString: databaseUrl });
    const second = new Client({ connectionString: databaseUrl });
    const observer = new Client({ connectionString: databaseUrl });
    await Promise.all([first.connect(), second.connect(), observer.connect()]);
    try {
      await first.query(fixtures(schema)); await first.query(migration); await first.query(insert(1, userA, 3));
      await first.query('CREATE TEMP TABLE enrollment_program_capacity_claims (LIKE enrollment_program_capacity_claims INCLUDING ALL)');
      await first.query(insert(2, userB, 4)); await first.query('DROP TABLE pg_temp.enrollment_program_capacity_claims');
      await Promise.all([first.query(`SET search_path=${schema},public; SET application_name='capacity-first'; BEGIN ISOLATION LEVEL REPEATABLE READ; SELECT count(*) FROM enrollments`), second.query(`SET search_path=${schema},public; SET application_name='capacity-second'; BEGIN ISOLATION LEVEL REPEATABLE READ; SELECT count(*) FROM enrollments`)]);
      const winner = first.query(insert(3, userA, 4)); await winner;
      const loser = second.query(insert(4, userA, 5));
      await waitForLock(observer, 'capacity-second');
      await first.query('COMMIT');
      await expect(loser).rejects.toMatchObject(capacityError); await second.query('ROLLBACK');
      await expect(first.query('SELECT count(*)::int AS count FROM enrollments WHERE active')).resolves.toMatchObject({ rows: [{ count: 3 }] });
      await expect(claimCount(first)).resolves.toMatchObject({ rows: [{ count: 3 }] });
    } finally {
      await Promise.allSettled([first.query('ROLLBACK'), second.query('ROLLBACK')]);
      await first.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`); await Promise.all([first.end(), second.end(), observer.end()]);
    }
  });

  dbIt('locks class programs before deriving capacity claims', async () => {
    const schema = `enrollment_class_lock_${randomBytes(6).toString('hex')}`;
    const updater = new Client({ connectionString: databaseUrl });
    const migrator = new Client({ connectionString: databaseUrl });
    const observer = new Client({ connectionString: databaseUrl });
    await Promise.all([updater.connect(), migrator.connect(), observer.connect()]);
    try {
      await updater.query(fixtures(schema)); await updater.query(insert(1, userA, 1));
      await updater.query(`SET application_name='class-updater'; BEGIN; UPDATE classes SET formative_program_type='GUIDE_MAJOR' WHERE class_id=1`);
      await migrator.query(`SET search_path=${schema},public; SET application_name='capacity-migration'`);
      const applying = migrator.query(migration);
      await waitForLock(observer, 'capacity-migration'); await updater.query('COMMIT'); await applying;
      await expect(migrator.query(`SELECT class.formative_program_type::text AS class_program,
        claim.formative_program_type::text AS claim_program FROM enrollments enrollment
        JOIN classes class USING (class_id) JOIN enrollment_program_capacity_claims claim USING (enrollment_id)`))
        .resolves.toMatchObject({ rows: [{ class_program: 'GUIDE_MAJOR', claim_program: 'GUIDE_MAJOR' }] });
    } finally {
      await Promise.allSettled([updater.query('ROLLBACK'), migrator.query('ROLLBACK')]);
      await updater.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`); await Promise.all([updater.end(), migrator.end(), observer.end()]);
    }
  });
});
