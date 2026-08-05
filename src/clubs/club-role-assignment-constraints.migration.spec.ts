import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Client } from 'pg';

const migration = readFileSync(
  join(
    __dirname,
    '../../prisma/migrations/20260730170000_assignment_constraints_gm_identity/migration.sql',
  ),
  'utf8',
);
const databaseUrl = process.env.AUTHORIZATION_P0_INTEGRATION_DATABASE_URL;
const dbIt =
  process.env.ALLOW_AUTHORIZATION_P0_INTEGRATION_DB === '1' && databaseUrl
    ? it
    : it.skip;
const [director, deputy, secretary, secTreasurer] = [1, 2, 3, 4].map(
  (value) => `10000000-0000-0000-0000-${String(value).padStart(12, '0')}`,
);
const id = (value: number, prefix = '20000000') =>
  `${prefix}-0000-0000-0000-${String(value).padStart(12, '0')}`;
const fixtures = (schema: string) => `
  CREATE SCHEMA ${schema}; SET search_path=${schema},public;
  CREATE TABLE roles (role_id uuid PRIMARY KEY, role_name text NOT NULL, role_category text NOT NULL, active boolean NOT NULL DEFAULT true);
  CREATE TABLE role_slot_limits (role_id uuid PRIMARY KEY REFERENCES roles(role_id), max_per_section integer NOT NULL);
  CREATE TABLE club_role_assignments (assignment_id uuid PRIMARY KEY, user_id uuid NOT NULL, role_id uuid NOT NULL, ecclesiastical_year_id integer NOT NULL, start_date date NOT NULL, end_date date, active boolean NOT NULL DEFAULT true, status varchar(20) DEFAULT 'active', club_section_id integer);
  CREATE TABLE classes (class_id integer PRIMARY KEY, asset_code varchar(10));
  INSERT INTO roles VALUES ('${director}','director','CLUB',true),('${deputy}','deputy-director','CLUB',true),('${secretary}','secretary','CLUB',true),('${secTreasurer}','secretary-treasurer','CLUB',true);
  INSERT INTO role_slot_limits VALUES ('${director}',1),('${deputy}',2),('${secretary}',1),('${secTreasurer}',1);
  INSERT INTO club_role_assignments VALUES ('${id(1)}','${id(1, '30000000')}','${director}',1,'2027-02-01','2027-01-01',true,'active',1);
  INSERT INTO club_role_assignments VALUES ('${id(40)}','${id(40, '30000000')}','${secretary}',1,'2027-09-01','2027-08-01',true,'active',1);
`;
const assignment = (
  value: number,
  role: string,
  start: string,
  end: string | null,
  status = 'active',
  active = true,
) =>
  `INSERT INTO club_role_assignments VALUES ('${id(value)}','${id(value, '30000000')}','${role}',1,'${start}',${end ? `'${end}'` : 'NULL'},${active},'${status}',1)`;
const fails = (db: Client, sql: string, constraint?: string) =>
  expect(db.query(sql)).rejects.toMatchObject({
    code: '23514',
    ...(constraint ? { constraint } : {}),
  });
const schemaTest = async (
  name: string,
  callback: (db: Client, schema: string) => Promise<void>,
) => {
  if (!databaseUrl) throw new Error('integration URL required');
  const schema = `${name}_${randomBytes(6).toString('hex')}`;
  const db = new Client({ connectionString: databaseUrl });
  await db.connect();
  try {
    await db.query(fixtures(schema));
    await db.query(`SET search_path=${schema},public; ${migration}`);
    await callback(db, schema);
  } finally {
    await db.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    await db.end();
  }
};

describe('club role assignment constraints migration', () => {
  dbIt(
    'enforces nullable identity, date ranges, temporal peaks, and exclusive roles',
    () =>
      schemaTest('be03', async (db) => {
        await db.query(
          "INSERT INTO classes VALUES (1,NULL),(2,NULL),(3,'GM-01')",
        );
        await expect(
          db.query("INSERT INTO classes VALUES (4,'GM-01')"),
        ).rejects.toMatchObject({
          code: '23505',
          constraint: 'classes_asset_code_key',
        });
        await fails(
          db,
          assignment(2, deputy, '2027-02-02', '2027-02-01'),
          'club_role_assignments_date_range_check',
        );
        await db.query(assignment(3, director, '2027-02-01', '2027-02-01'));
        await fails(
          db,
          `UPDATE club_role_assignments SET active=true WHERE assignment_id='${id(1)}'`,
          'club_role_assignments_date_range_check',
        );
        for (const [value, start, end] of [
          [10, '2027-01-01', '2027-01-31'],
          [11, '2027-03-01', '2027-03-31'],
        ] as const)
          await db.query(assignment(value, deputy, start, end));
        await db.query(assignment(12, deputy, '2027-01-01', '2027-03-31'));
        await db.query(assignment(13, deputy, '2027-02-01', '2027-02-28'));
        await fails(db, assignment(14, deputy, '2027-02-02', '2027-02-27'));
        await fails(db, assignment(15, deputy, '2027-03-31', '2027-04-01'));
        await db.query(
          `UPDATE club_role_assignments SET end_date='2027-02-01' WHERE assignment_id='${id(3)}'`,
        );
        await db.query(assignment(20, secretary, '2027-06-01', '2027-06-30'));
        await fails(
          db,
          assignment(21, secTreasurer, '2027-06-30', '2027-07-01'),
        );
        await db.query(
          assignment(22, secTreasurer, '2027-07-01', '2027-07-31'),
        );
        await db.query(
          assignment(23, secTreasurer, '2027-08-01', '2027-10-01'),
        );
      }),
  );

  dbIt('serializes conflicting exclusive writes', () =>
    schemaTest('be03_slots', async (first, schema) => {
      const second = new Client({ connectionString: databaseUrl });
      await second.connect();
      try {
        await Promise.all([
          first.query('BEGIN'),
          second.query(`SET search_path=${schema},public; BEGIN`),
        ]);
        await first.query(
          assignment(30, secretary, '2027-08-01', '2027-08-31'),
        );
        const conflict = second.query(
          assignment(31, secTreasurer, '2027-08-01', '2027-08-31'),
        );
        await first.query('COMMIT');
        await expect(conflict).rejects.toMatchObject({ code: '23514' });
        await second.query('ROLLBACK');
      } finally {
        await second.end();
      }
    }),
  );
});
