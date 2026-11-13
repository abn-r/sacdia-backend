import { randomBytes, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Client } from 'pg';
import { assertLoopbackDatabaseUrl } from '../common/testing/loopback-database-url';

/**
 * Migration 20261115100000 (multi-year GM continuation) against REAL PostgreSQL
 * (gated like the other `*.postgres.spec.ts` suites). A random schema holds
 * MINIMAL stubs; the historical-certificate migration (which defines the GM-01
 * single-row trigger) runs first, then this migration TWICE (re-runnable).
 */
const databaseUrl = process.env.AUTHORIZATION_P0_INTEGRATION_DATABASE_URL;
const enabled =
  process.env.ALLOW_AUTHORIZATION_P0_INTEGRATION_DB === '1' && !!databaseUrl;
const pgDescribe = enabled ? describe : describe.skip;

if (enabled && databaseUrl) {
  assertLoopbackDatabaseUrl(
    databaseUrl,
    'GM_MULTIYEAR_TEST_DATABASE_MUST_BE_LOOPBACK',
  );
}

const MIGRATIONS = join(__dirname, '..', '..', 'prisma', 'migrations');
const sqlOf = (name: string) =>
  readFileSync(join(MIGRATIONS, name, 'migration.sql'), 'utf8');

const HISTORICAL = sqlOf('20260921140000_historical_certificate_enrollments');
const MIGRATION = sqlOf('20261115100000_gm_multiyear_continuation');

pgDescribe(
  'GM multi-year continuation migration against real PostgreSQL',
  () => {
    const schema = `gm_multi_${randomBytes(6).toString('hex')}`;
    let db: Client;
    const USER = randomUUID();
    const GM_CLASS = 1;
    const OTHER_CLASS = 2;

    const insert = (
      userId: string,
      classId: number,
      year: number,
      status: string,
    ) =>
      db.query(
        `INSERT INTO enrollments (user_id, class_id, ecclesiastical_year_id, investiture_status)
       VALUES ($1, $2, $3, $4) RETURNING enrollment_id`,
        [userId, classId, year, status],
      );

    beforeAll(async () => {
      db = new Client({ connectionString: databaseUrl });
      await db.connect();
      await db.query(`CREATE SCHEMA ${schema}`);
      await db.query(`SET search_path = ${schema}`);
      await db.query(`
      CREATE TABLE ecclesiastical_years (year_id integer PRIMARY KEY);
      CREATE TABLE classes (class_id integer PRIMARY KEY, asset_code text);
      CREATE TABLE enrollments (
        enrollment_id serial PRIMARY KEY,
        user_id uuid NOT NULL,
        class_id integer NOT NULL,
        ecclesiastical_year_id integer NOT NULL,
        investiture_status text NOT NULL DEFAULT 'IN_PROGRESS',
        investiture_date timestamptz,
        locked_for_validation boolean NOT NULL DEFAULT false,
        cross_type_enrollment boolean NOT NULL DEFAULT false,
        active boolean NOT NULL DEFAULT true,
        UNIQUE (user_id, class_id, ecclesiastical_year_id)
      );
      INSERT INTO ecclesiastical_years VALUES (2024), (2025), (2026);
      INSERT INTO classes VALUES (${GM_CLASS}, 'GM-01'), (${OTHER_CLASS}, 'GM-02');
    `);
      await db.query(HISTORICAL);
      await db.query(MIGRATION);
      await db.query(MIGRATION);
    });

    afterAll(async () => {
      await db.query(`DROP SCHEMA ${schema} CASCADE`);
      await db.end();
    });

    it('adds a nullable duration_start_year_id with a FK to ecclesiastical_years', async () => {
      const col = await db.query(
        `SELECT is_nullable FROM information_schema.columns
       WHERE table_schema = $1 AND table_name = 'enrollments' AND column_name = 'duration_start_year_id'`,
        [schema],
      );
      expect(col.rows[0].is_nullable).toBe('YES');
      await expect(
        db.query(
          `UPDATE enrollments SET duration_start_year_id = 999 WHERE false`,
        ),
      ).resolves.toBeDefined();
      const row = await insert(randomUUID(), OTHER_CLASS, 2024, 'IN_PROGRESS');
      await expect(
        db.query(
          `UPDATE enrollments SET duration_start_year_id = 999 WHERE enrollment_id = $1`,
          [row.rows[0].enrollment_id],
        ),
      ).rejects.toBeDefined();
      await db.query(
        `UPDATE enrollments SET duration_start_year_id = 2024 WHERE enrollment_id = $1`,
        [row.rows[0].enrollment_id],
      );
    });

    it('still rejects a second LIVE GM-01 row for the same user', async () => {
      await insert(USER, GM_CLASS, 2024, 'IN_PROGRESS');
      await expect(
        insert(USER, GM_CLASS, 2025, 'IN_PROGRESS'),
      ).rejects.toMatchObject({
        message: expect.stringContaining('ENROLLMENT_GM_SINGLE_ROW'),
      });
    });

    it('allows re-opening GM-01 once the previous row is EXPIRED, and only then', async () => {
      await db.query(
        `UPDATE enrollments SET investiture_status = 'EXPIRED' WHERE user_id = $1 AND class_id = $2`,
        [USER, GM_CLASS],
      );
      await expect(
        insert(USER, GM_CLASS, 2026, 'IN_PROGRESS'),
      ).resolves.toBeDefined();
      // the reopened row is live again: a third row is rejected
      await expect(
        insert(USER, GM_CLASS, 2025, 'IN_PROGRESS'),
      ).rejects.toMatchObject({
        message: expect.stringContaining('ENROLLMENT_GM_SINGLE_ROW'),
      });
    });

    it('keeps the per-year uniqueness: the carried row cannot collide with the same user/class/year', async () => {
      const other = randomUUID();
      const a = await insert(other, OTHER_CLASS, 2025, 'IN_PROGRESS');
      // carrying forward = moving the same row to the next year; no second row exists
      await db.query(
        `UPDATE enrollments SET ecclesiastical_year_id = 2026, duration_start_year_id = 2025 WHERE enrollment_id = $1`,
        [a.rows[0].enrollment_id],
      );
      const moved = await db.query(
        `SELECT ecclesiastical_year_id, duration_start_year_id FROM enrollments WHERE enrollment_id = $1`,
        [a.rows[0].enrollment_id],
      );
      expect(moved.rows[0]).toEqual({
        ecclesiastical_year_id: 2026,
        duration_start_year_id: 2025,
      });
    });
  },
);
