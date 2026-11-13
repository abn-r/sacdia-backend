import { randomBytes, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Client } from 'pg';
import { assertLoopbackDatabaseUrl } from '../common/testing/loopback-database-url';

/**
 * Phase 4 rename DO block (20261113130000) against REAL PostgreSQL, gated like
 * the other `*.postgres.spec.ts` suites. Minimal stubs of the three touched
 * tables in a random schema; covers the three states of each pair, a re-run
 * (no-op) and the preservation of permission ids and grants.
 */
const databaseUrl = process.env.AUTHORIZATION_P0_INTEGRATION_DATABASE_URL;
const enabled =
  process.env.ALLOW_AUTHORIZATION_P0_INTEGRATION_DB === '1' && !!databaseUrl;
const pgDescribe = enabled ? describe : describe.skip;

if (enabled && databaseUrl) {
  assertLoopbackDatabaseUrl(
    databaseUrl,
    'FAMILY_PERMISSION_RENAME_TEST_DATABASE_MUST_BE_LOOPBACK',
  );
}

const SQL = readFileSync(
  join(
    __dirname,
    '..',
    '..',
    'prisma',
    'migrations',
    '20261113130000_family_guardianship_permission_rename',
    'migration.sql',
  ),
  'utf8',
);

pgDescribe('guardianship permission rename against real PostgreSQL', () => {
  const schema = `fam_perm_${randomBytes(6).toString('hex')}`;
  let db: Client;

  const reset = async () => {
    await db.query(
      'TRUNCATE role_permissions, users_permissions, permissions CASCADE',
    );
  };
  const addPermission = async (name: string): Promise<string> => {
    const id = randomUUID();
    await db.query(
      'INSERT INTO permissions (permission_id, permission_name, description) VALUES ($1, $2, $3)',
      [id, name, 'x'],
    );
    return id;
  };
  const names = async (): Promise<string[]> =>
    (
      await db.query(
        "SELECT permission_name FROM permissions WHERE permission_name LIKE '%representative%' OR permission_name LIKE 'guardianship:%' ORDER BY 1",
      )
    ).rows.map((r) => r.permission_name);

  beforeAll(async () => {
    db = new Client({ connectionString: databaseUrl });
    await db.connect();
    await db.query(`CREATE SCHEMA ${schema}`);
    await db.query(`SET search_path = ${schema}`);
    await db.query(`
      CREATE TABLE permissions (
        permission_id uuid PRIMARY KEY,
        permission_name varchar(255) NOT NULL UNIQUE,
        description text,
        modified_at timestamptz DEFAULT now(),
        active boolean NOT NULL DEFAULT true
      );
      CREATE TABLE role_permissions (
        role_permission_id uuid PRIMARY KEY,
        role_id uuid NOT NULL,
        permission_id uuid NOT NULL REFERENCES permissions ON DELETE CASCADE,
        active boolean NOT NULL DEFAULT true,
        UNIQUE (role_id, permission_id)
      );
      CREATE TABLE users_permissions (
        user_permission_id uuid PRIMARY KEY,
        user_id uuid NOT NULL,
        permission_id uuid NOT NULL REFERENCES permissions ON DELETE CASCADE,
        active boolean NOT NULL DEFAULT true,
        UNIQUE (user_id, permission_id)
      );
    `);
  });

  afterAll(async () => {
    await db.query(`DROP SCHEMA ${schema} CASCADE`);
    await db.end();
  });

  it('old only: renames in place, keeping permission_id and the grants', async () => {
    await reset();
    const oldId = await addPermission('legal_representative:read');
    const role = randomUUID();
    await db.query(
      'INSERT INTO role_permissions VALUES (gen_random_uuid(), $1, $2, true)',
      [role, oldId],
    );

    await db.query(SQL);

    const row = await db.query(
      "SELECT permission_id, description FROM permissions WHERE permission_name = 'guardianship:read'",
    );
    expect(row.rows[0].permission_id).toBe(oldId);
    expect(row.rows[0].description).toBe(
      'Read user guardianship (family) info',
    );
    const grants = await db.query(
      'SELECT 1 FROM role_permissions WHERE role_id = $1 AND permission_id = $2',
      [role, oldId],
    );
    expect(grants.rowCount).toBe(1);
    // The untouched pair (update) is created by the `neither` branch.
    expect(await names()).toEqual(['guardianship:read', 'guardianship:update']);
  });

  it('both: merges role and user grants onto the new row, then removes the old', async () => {
    await reset();
    const oldId = await addPermission('legal_representative:update');
    const newId = await addPermission('guardianship:update');
    const roleOnlyOld = randomUUID();
    const roleBoth = randomUUID();
    const user = randomUUID();
    await db.query(
      `INSERT INTO role_permissions VALUES
        (gen_random_uuid(), $1, $3, true), (gen_random_uuid(), $2, $3, true),
        (gen_random_uuid(), $2, $4, true)`,
      [roleOnlyOld, roleBoth, oldId, newId],
    );
    await db.query(
      'INSERT INTO users_permissions VALUES (gen_random_uuid(), $1, $2, true)',
      [user, oldId],
    );

    await db.query(SQL);

    const roles = await db.query(
      'SELECT role_id FROM role_permissions WHERE permission_id = $1',
      [newId],
    );
    expect(roles.rows.map((r) => r.role_id).sort()).toEqual(
      [roleOnlyOld, roleBoth].sort(),
    );
    const users = await db.query(
      'SELECT user_id FROM users_permissions WHERE permission_id = $1',
      [newId],
    );
    expect(users.rows.map((r) => r.user_id)).toEqual([user]);
    expect(await names()).toEqual(['guardianship:read', 'guardianship:update']);
  });

  it('neither: inserts both new permissions', async () => {
    await reset();
    await db.query(SQL);
    expect(await names()).toEqual(['guardianship:read', 'guardianship:update']);
  });

  it('is a no-op when run twice and when only the new names exist', async () => {
    await reset();
    await addPermission('legal_representative:read');
    await db.query(SQL);
    const before = await db.query(
      'SELECT permission_id, permission_name FROM permissions ORDER BY 2',
    );
    await db.query(SQL);
    const after = await db.query(
      'SELECT permission_id, permission_name FROM permissions ORDER BY 2',
    );
    expect(after.rows.map((r) => r.permission_name)).toEqual(
      before.rows.map((r) => r.permission_name),
    );
    // Second run inserted nothing new for guardianship:read (new only => no-op).
    const countRead = await db.query(
      "SELECT count(*)::int AS n FROM permissions WHERE permission_name = 'guardianship:read'",
    );
    expect(countRead.rows[0].n).toBe(1);
  });
});
