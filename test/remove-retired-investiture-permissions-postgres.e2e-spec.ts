import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  prepareAnnualCycleDatabase,
  withClient,
} from './helpers/annual-cycle-db.helper';

jest.setTimeout(180000);

const MIGRATION_SQL = readFileSync(
  join(
    __dirname,
    '../prisma/migrations/20261013110000_remove_retired_investiture_permissions/migration.sql',
  ),
  'utf8',
);

const RETIRED = [
  'investiture:submit',
  'investiture:validate',
  'investiture:mark_invested',
  'investiture_config:read',
  'investiture_config:create',
  'investiture_config:update',
  'investiture_config:delete',
];
const KEPT = ['investiture:read', 'club_members:approve'];

function ensureTestDatabaseUrl(): void {
  if (process.env.SACDIA_TEST_DATABASE_URL?.trim()) {
    return;
  }
  try {
    const text = readFileSync(join(__dirname, '../.env.test.local'), 'utf8');
    for (const line of text.split('\n')) {
      const trimmed = line.trim();
      if (trimmed.startsWith('SACDIA_TEST_DATABASE_URL=')) {
        process.env.SACDIA_TEST_DATABASE_URL = trimmed
          .slice('SACDIA_TEST_DATABASE_URL='.length)
          .trim()
          .replace(/^["']|["']$/g, '');
        return;
      }
    }
  } catch {
    // sin archivo local: assertSafeTestDatabaseUrl fallará con un código claro
  }
}

describe('remove retired investiture permissions on isolated PostgreSQL', () => {
  let url: string;
  const userId = 'a2000000-0000-4000-8000-000000000001';

  beforeAll(async () => {
    ensureTestDatabaseUrl();
    url = await prepareAnnualCycleDatabase();
    await withClient(url, async (client) => {
      await client.query(
        `INSERT INTO permissions (permission_name, description, active)
         SELECT unnest($1::text[]), 'seed', true
         ON CONFLICT (permission_name) DO NOTHING`,
        [[...RETIRED, ...KEPT]],
      );
      await client.query(
        `INSERT INTO roles (role_name, description, role_category, active)
         VALUES ('coordinator', 'Coordinador', 'GLOBAL', true),
                ('director', 'Director', 'CLUB', true)
         ON CONFLICT (role_name) DO NOTHING`,
      );
      await client.query(
        `INSERT INTO role_permissions (role_id, permission_id, active)
         SELECT r.role_id, p.permission_id, true
         FROM roles r CROSS JOIN permissions p
         WHERE r.role_name IN ('coordinator', 'director')
           AND p.permission_name = ANY($1::text[])
         ON CONFLICT (role_id, permission_id) DO NOTHING`,
        [[...RETIRED, ...KEPT]],
      );
      await client.query(
        `INSERT INTO users (user_id, email, name, paternal_last_name, maternal_last_name)
         VALUES ($1, 'perm-probe@example.test', 'Probe', 'Probe', 'Probe')`,
        [userId],
      );
      await client.query(
        `INSERT INTO users_permissions (user_id, permission_id, active)
         SELECT $1, permission_id, true FROM permissions
         WHERE permission_name = ANY($2::text[])`,
        [userId, [...RETIRED, 'investiture:read']],
      );
    });
  });

  async function counts(client: import('pg').Client) {
    const q = async (sql: string) =>
      Number((await client.query<{ n: string }>(sql, [RETIRED])).rows[0].n);
    return {
      permissions: await q(
        `SELECT count(*) n FROM permissions WHERE permission_name = ANY($1::text[])`,
      ),
      roleGrants: await q(
        `SELECT count(*) n FROM role_permissions rp JOIN permissions p USING (permission_id) WHERE p.permission_name = ANY($1::text[])`,
      ),
      userGrants: await q(
        `SELECT count(*) n FROM users_permissions up JOIN permissions p USING (permission_id) WHERE p.permission_name = ANY($1::text[])`,
      ),
    };
  }

  it('removes the retired permissions and their grants, keeps investiture:read, and is a no-op on re-run', async () => {
    await withClient(url, async (client) => {
      expect(await counts(client)).toEqual({
        permissions: 7,
        roleGrants: 14,
        userGrants: 7,
      });
      const keptBefore = await client.query(
        `SELECT
           (SELECT count(*) FROM role_permissions rp JOIN permissions p USING (permission_id) WHERE p.permission_name IN ('investiture:read','club_members:approve')) AS role_kept,
           (SELECT count(*) FROM users_permissions up JOIN permissions p USING (permission_id) WHERE p.permission_name = 'investiture:read') AS user_kept,
           (SELECT count(*) FROM users) AS users`,
      );

      await client.query(MIGRATION_SQL);

      expect(await counts(client)).toEqual({
        permissions: 0,
        roleGrants: 0,
        userGrants: 0,
      });
      const keptAfter = await client.query(
        `SELECT
           (SELECT count(*) FROM role_permissions rp JOIN permissions p USING (permission_id) WHERE p.permission_name IN ('investiture:read','club_members:approve')) AS role_kept,
           (SELECT count(*) FROM users_permissions up JOIN permissions p USING (permission_id) WHERE p.permission_name = 'investiture:read') AS user_kept,
           (SELECT count(*) FROM users) AS users`,
      );
      expect(keptAfter.rows[0]).toEqual(keptBefore.rows[0]);
      const stillThere = await client.query<{ permission_name: string }>(
        `SELECT permission_name FROM permissions WHERE permission_name = ANY($1::text[]) ORDER BY 1`,
        [KEPT],
      );
      expect(stillThere.rows.map((r) => r.permission_name)).toEqual([
        'club_members:approve',
        'investiture:read',
      ]);

      await client.query(MIGRATION_SQL);
      expect(await counts(client)).toEqual({
        permissions: 0,
        roleGrants: 0,
        userGrants: 0,
      });
      const keptRerun = await client.query(
        `SELECT count(*) n FROM permissions WHERE permission_name = ANY($1::text[])`,
        [KEPT],
      );
      expect(Number(keptRerun.rows[0].n)).toBe(2);
    });
  });
});
