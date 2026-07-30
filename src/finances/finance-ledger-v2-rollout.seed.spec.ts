import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Client } from 'pg';

const seed = (name: string) =>
  readFileSync(join(__dirname, '..', '..', 'prisma', 'seeds', name), 'utf8');
const permissionsSeed = seed('permissions.seed.sql');
const rolePermissionsSeed = seed('role-permissions.seed.sql');
const systemConfigSeed = seed('system-config.seed.sql');
const databaseUrl = process.env.AUTHORIZATION_P0_INTEGRATION_DATABASE_URL;
const dbIt =
  process.env.ALLOW_AUTHORIZATION_P0_INTEGRATION_DB === '1' && databaseUrl
    ? it
    : it.skip;

describe('finance ledger v2 rollout seeds', () => {
  dbIt(
    'grants finance duties exactly and keeps writes disabled by default',
    async () => {
      if (!databaseUrl) throw new Error('integration URL required');
      const schema = `finance_wu1b_rollout_${randomBytes(6).toString('hex')}`;
      const client = new Client({ connectionString: databaseUrl });
      await client.connect();
      try {
        await client.query(`CREATE SCHEMA ${schema}; SET search_path=${schema},public;
        CREATE TABLE permissions (permission_id UUID PRIMARY KEY DEFAULT gen_random_uuid(), permission_name VARCHAR(255) UNIQUE NOT NULL, description TEXT, active BOOLEAN DEFAULT true, modified_at TIMESTAMPTZ DEFAULT now());
        CREATE TABLE roles (role_id UUID PRIMARY KEY DEFAULT gen_random_uuid(), role_name VARCHAR(255) UNIQUE NOT NULL, role_category TEXT NOT NULL, active BOOLEAN DEFAULT true);
        CREATE TABLE role_permissions (role_permission_id UUID PRIMARY KEY, role_id UUID NOT NULL, permission_id UUID NOT NULL, active BOOLEAN DEFAULT true, modified_at TIMESTAMPTZ DEFAULT now(), UNIQUE(role_id, permission_id));
        CREATE TABLE system_config (config_key TEXT PRIMARY KEY, config_value TEXT NOT NULL, description TEXT NOT NULL, config_type TEXT NOT NULL, updated_at TIMESTAMPTZ DEFAULT now());
        INSERT INTO roles (role_name, role_category) VALUES
          ('treasurer','CLUB'), ('secretary-treasurer','CLUB'), ('director','CLUB'),
          ('deputy-director','CLUB'), ('admin','GLOBAL'), ('super-admin','GLOBAL');`);
        await client.query(permissionsSeed);
        await client.query(rolePermissionsSeed);
        await client.query(rolePermissionsSeed);
        await client.query(systemConfigSeed);
        const grants = await client.query<{
          role_name: string;
          permission_name: string;
        }>(
          `SELECT r.role_name, p.permission_name FROM role_permissions rp
         JOIN roles r USING (role_id) JOIN permissions p USING (permission_id)
         WHERE rp.active AND p.permission_name IN ('finances:register','finances:approve')
         ORDER BY p.permission_name, r.role_name`,
        );
        expect(grants.rows).toEqual([
          { role_name: 'director', permission_name: 'finances:approve' },
          {
            role_name: 'secretary-treasurer',
            permission_name: 'finances:register',
          },
          { role_name: 'treasurer', permission_name: 'finances:register' },
        ]);
        await expect(
          client.query(
            `SELECT config_value FROM system_config WHERE config_key='finance.ledger_v2_writes_enabled'`,
          ),
        ).resolves.toMatchObject({ rows: [{ config_value: 'false' }] });
        await client.query(
          `UPDATE system_config SET config_value='true' WHERE config_key='finance.ledger_v2_writes_enabled'`,
        );
        await client.query(systemConfigSeed);
        await expect(
          client.query(
            `SELECT config_value FROM system_config WHERE config_key='finance.ledger_v2_writes_enabled'`,
          ),
        ).resolves.toMatchObject({ rows: [{ config_value: 'true' }] });
      } finally {
        await client.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
        await client.end();
      }
    },
  );
});
