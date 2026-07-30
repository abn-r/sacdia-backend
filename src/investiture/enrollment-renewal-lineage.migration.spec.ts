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
    '20260730191000_enrollment_renewal_lineage',
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
  CREATE TABLE enrollments (
    enrollment_id integer PRIMARY KEY,
    user_id uuid NOT NULL,
    class_id integer NOT NULL,
    ecclesiastical_year_id integer NOT NULL,
    investiture_status text NOT NULL DEFAULT 'IN_PROGRESS',
    active boolean NOT NULL DEFAULT true
  );
  CREATE TABLE class_section_progress (
    section_progress_id integer PRIMARY KEY,
    enrollment_id integer NOT NULL REFERENCES enrollments(enrollment_id)
  );
  INSERT INTO enrollments VALUES (1, '${userA}', 3, 2026, 'EXPIRED', false);
  INSERT INTO class_section_progress VALUES (1, 1);
`;

const insertRenewal = (
  enrollmentId: number,
  userId: string,
  classId: number,
  yearId: number,
  renewedFromId: number,
) => `
  INSERT INTO enrollments (
    enrollment_id, user_id, class_id, ecclesiastical_year_id,
    renewed_from_enrollment_id
  ) VALUES (
    ${enrollmentId}, '${userId}', ${classId}, ${yearId}, ${renewedFromId}
  )
`;

describe('enrollment renewal lineage migration', () => {
  dbIt(
    'enforces same-identity immutable acyclic lineage without copying progress',
    async () => {
      if (!databaseUrl) throw new Error('integration URL required');
      const schema = `investiture_renewal_${randomBytes(6).toString('hex')}`;
      const client = new Client({ connectionString: databaseUrl });
      await client.connect();
      try {
        await client.query(fixtures(schema));
        await client.query(`SET search_path=${schema},public; ${migration}`);

        await expect(
          client.query(insertRenewal(2, userB, 3, 2027, 1)),
        ).rejects.toMatchObject({
          code: '23514',
          constraint: 'enrollments_renewal_identity_check',
        });
        await expect(
          client.query(insertRenewal(3, userA, 4, 2027, 1)),
        ).rejects.toMatchObject({
          code: '23514',
          constraint: 'enrollments_renewal_identity_check',
        });

        await client.query(insertRenewal(2, userA, 3, 2027, 1));
        await expect(
          client.query(
            'UPDATE enrollments SET renewed_from_enrollment_id = 2 WHERE enrollment_id = 1',
          ),
        ).rejects.toMatchObject({
          code: '23514',
          constraint: 'enrollments_renewal_acyclic_check',
        });
        await client.query(insertRenewal(3, userA, 3, 2028, 2));

        await expect(
          client.query(
            'UPDATE enrollments SET renewed_from_enrollment_id = 3 WHERE enrollment_id = 1',
          ),
        ).rejects.toMatchObject({
          code: '23514',
          constraint: 'enrollments_renewal_acyclic_check',
        });
        await expect(
          client.query(
            'UPDATE enrollments SET renewed_from_enrollment_id = 3 WHERE enrollment_id = 2',
          ),
        ).rejects.toMatchObject({
          code: '23514',
          constraint: 'enrollments_renewal_source_immutable_check',
        });
        await expect(
          client.query(
            'UPDATE enrollments SET renewed_from_enrollment_id = NULL WHERE enrollment_id = 2',
          ),
        ).rejects.toMatchObject({
          code: '23514',
          constraint: 'enrollments_renewal_source_immutable_check',
        });
        await expect(
          client.query(`UPDATE enrollments SET user_id = '${userB}'
            WHERE enrollment_id = 1`),
        ).rejects.toMatchObject({
          code: '23514',
          constraint: 'enrollments_renewal_identity_immutable_check',
        });
        await expect(
          client.query(insertRenewal(4, userA, 3, 2029, 1)),
        ).rejects.toMatchObject({
          code: '23505',
          constraint: 'enrollments_renewed_from_enrollment_id_key',
        });

        await expect(
          client.query(
            `SELECT enrollment_id, renewed_from_enrollment_id
             FROM enrollments ORDER BY enrollment_id`,
          ),
        ).resolves.toMatchObject({
          rows: [
            { enrollment_id: 1, renewed_from_enrollment_id: null },
            { enrollment_id: 2, renewed_from_enrollment_id: 1 },
            { enrollment_id: 3, renewed_from_enrollment_id: 2 },
          ],
        });
        await expect(
          client.query('SELECT enrollment_id FROM class_section_progress'),
        ).resolves.toMatchObject({ rows: [{ enrollment_id: 1 }] });

        await client.query('DELETE FROM class_section_progress');
        const version = await client.query<{ server_version_num: string }>(
          'SHOW server_version_num',
        );
        const restrictCode =
          Number(version.rows[0].server_version_num) >= 180000
            ? '23001'
            : '23503';
        await expect(
          client.query('DELETE FROM enrollments WHERE enrollment_id = 1'),
        ).rejects.toMatchObject({
          code: restrictCode,
          constraint: 'enrollments_renewed_from_enrollment_id_fkey',
        });
      } finally {
        await client.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
        await client.end();
      }
    },
  );

  dbIt('rolls back every DDL object when migration fails', async () => {
    if (!databaseUrl) throw new Error('integration URL required');
    const schema = `investiture_rollback_${randomBytes(6).toString('hex')}`;
    const client = new Client({ connectionString: databaseUrl });
    await client.connect();
    try {
      await client.query(fixtures(schema));
      await expect(
        client.query(
          `SET search_path=${schema},public; ${migration.replace(
            'COMMIT;',
            'SELECT 1 / 0; COMMIT;',
          )}`,
        ),
      ).rejects.toMatchObject({ code: '22012' });
      await client.query('ROLLBACK');
      await expect(
        client.query(
          `SELECT count(*)::int AS count
           FROM information_schema.columns
           WHERE table_schema = '${schema}'
             AND table_name = 'enrollments'
             AND column_name = 'renewed_from_enrollment_id'`,
        ),
      ).resolves.toMatchObject({ rows: [{ count: 0 }] });
      await expect(
        client.query(
          `SELECT count(*)::int AS count
           FROM pg_proc
           WHERE pronamespace = '${schema}'::regnamespace
             AND proname = 'enforce_enrollment_renewal_lineage'`,
        ),
      ).resolves.toMatchObject({ rows: [{ count: 0 }] });
    } finally {
      await client.query('ROLLBACK');
      await client.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
      await client.end();
    }
  });
});
