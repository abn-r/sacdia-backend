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
  INSERT INTO enrollments (
    enrollment_id, user_id, class_id, ecclesiastical_year_id, investiture_status
  ) VALUES (
    1, 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11', 3, 2026, 'EXPIRED'
  );
  INSERT INTO class_section_progress (section_progress_id, enrollment_id)
  VALUES (1, 1);
`;

describe('enrollment renewal lineage migration', () => {
  dbIt(
    'preserves an immutable one-to-one renewal lineage without copying progress',
    async () => {
      if (!databaseUrl) throw new Error('integration URL required');
      const schema = `investiture_renewal_${randomBytes(6).toString('hex')}`;
      const client = new Client({ connectionString: databaseUrl });
      await client.connect();
      try {
        await client.query(fixtures(schema));
        await client.query(`SET search_path=${schema},public; ${migration}`);
        await client.query(
          'UPDATE enrollments SET active = false WHERE enrollment_id = 1',
        );

        await client.query(`
          INSERT INTO enrollments (
            enrollment_id,
            user_id,
            class_id,
            ecclesiastical_year_id,
            renewed_from_enrollment_id
          ) VALUES (
            2, 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11', 3, 2027, 1
          )
        `);

        await expect(
          client.query(
            `SELECT enrollment_id, renewed_from_enrollment_id, active
             FROM enrollments
             ORDER BY enrollment_id`,
          ),
        ).resolves.toMatchObject({
          rows: [
            {
              enrollment_id: 1,
              renewed_from_enrollment_id: null,
              active: false,
            },
            { enrollment_id: 2, renewed_from_enrollment_id: 1, active: true },
          ],
        });
        await expect(
          client.query(
            'SELECT enrollment_id FROM class_section_progress ORDER BY section_progress_id',
          ),
        ).resolves.toMatchObject({ rows: [{ enrollment_id: 1 }] });
        await expect(
          client.query(`
            INSERT INTO enrollments (
              enrollment_id,
              user_id,
              class_id,
              ecclesiastical_year_id,
              renewed_from_enrollment_id
            ) VALUES (
              3, 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11', 3, 2028, 1
            )
          `),
        ).rejects.toMatchObject({
          code: '23505',
          constraint: 'enrollments_renewed_from_enrollment_id_key',
        });
        await expect(
          client.query(`
            INSERT INTO enrollments (
              enrollment_id,
              user_id,
              class_id,
              ecclesiastical_year_id,
              renewed_from_enrollment_id
            ) VALUES (
              4, 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11', 3, 2029, 4
            )
          `),
        ).rejects.toMatchObject({
          code: '23514',
          constraint: 'enrollments_renewed_from_enrollment_id_check',
        });
        await client.query(
          'DELETE FROM class_section_progress WHERE enrollment_id = 1',
        );
        await expect(
          client.query('DELETE FROM enrollments WHERE enrollment_id = 1'),
        ).rejects.toMatchObject({
          code: '23503',
          constraint: 'enrollments_renewed_from_enrollment_id_fkey',
        });
      } finally {
        await client.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
        await client.end();
      }
    },
  );
});
