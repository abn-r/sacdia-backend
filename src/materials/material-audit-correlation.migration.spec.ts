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
    '20260803190000_material_audit_correlation',
    'migration.sql',
  ),
  'utf8',
);
const databaseUrl = process.env.MATERIALS_INTEGRATION_DATABASE_URL;
const dbIt =
  process.env.ALLOW_MATERIALS_INTEGRATION_DB === '1' && databaseUrl
    ? it
    : it.skip;

async function withSchema(run: (client: Client) => Promise<void>) {
  if (!databaseUrl) throw new Error('integration URL required');
  const schema = `materials_w3_audit_${randomBytes(6).toString('hex')}`;
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    await client.query(`CREATE SCHEMA ${schema}; SET search_path=${schema},public;
      CREATE TABLE material_audit_logs (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        local_field_id INT NOT NULL,
        actor_user_id UUID NOT NULL,
        entity_type VARCHAR(64) NOT NULL,
        entity_id VARCHAR(64) NOT NULL,
        action VARCHAR(96) NOT NULL,
        before_json JSONB,
        after_json JSONB,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );`);
    await run(client);
  } finally {
    await client.query('ROLLBACK').catch(() => undefined);
    await client.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    await client.end();
  }
}

describe('material audit correlation migration', () => {
  dbIt('adds durable correlation and its lookup index', () =>
    withSchema(async (client) => {
      await client.query(migration);
      await expect(
        client.query(`INSERT INTO material_audit_logs
          (local_field_id, actor_user_id, entity_type, entity_id, action, correlation_id)
          VALUES (7, '00000000-0000-0000-0000-000000000001',
            'category', 'category-1', 'category.updated',
            '00000000-0000-0000-0000-000000000002')`),
      ).resolves.toBeDefined();
      await expect(
        client.query(`SELECT indexname FROM pg_indexes
          WHERE schemaname = current_schema()
            AND indexname = 'idx_material_audit_correlation'`),
      ).resolves.toMatchObject({
        rows: [{ indexname: 'idx_material_audit_correlation' }],
      });
    }),
  );

  dbIt('rolls back the correlation schema atomically on failure', () =>
    withSchema(async (client) => {
      await expect(
        client.query(migration.replace('COMMIT;', 'SELECT 1 / 0; COMMIT;')),
      ).rejects.toMatchObject({ code: '22012' });
      await client.query('ROLLBACK');
      await expect(
        client.query(`SELECT COUNT(*)::int AS count
          FROM information_schema.columns
          WHERE table_schema = current_schema()
            AND table_name = 'material_audit_logs'
            AND column_name = 'correlation_id'`),
      ).resolves.toMatchObject({ rows: [{ count: 0 }] });
    }),
  );
});
