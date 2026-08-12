import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Client } from 'pg';

const readMigration = (name: string) =>
  readFileSync(
    join(__dirname, '..', '..', 'prisma', 'migrations', name, 'migration.sql'),
    'utf8',
  );

const durableMigration = readMigration('20260730180000_durable_audit_logs');
const httpAuditMigration = readMigration(
  '20260812190000_audit_http_operations',
);

const databaseUrl = process.env.AUTHORIZATION_P0_INTEGRATION_DATABASE_URL;
const dbIt =
  process.env.ALLOW_AUTHORIZATION_P0_INTEGRATION_DB === '1' && databaseUrl
    ? it
    : it.skip;

const createLegacyAuditLogs = (client: Client, schema: string) =>
  client.query(`CREATE SCHEMA ${schema}; SET search_path=${schema},public;
    CREATE TABLE audit_logs (
      audit_log_id BIGSERIAL PRIMARY KEY,
      entity_type VARCHAR(50) NOT NULL,
      entity_id VARCHAR(64) NOT NULL,
      action VARCHAR(20) NOT NULL CHECK (action IN ('CREATED', 'UPDATED', 'DELETED')),
      club_id INT,
      actor_user_id UUID,
      summary VARCHAR(500),
      changes JSONB,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    INSERT INTO audit_logs (entity_type, entity_id, action)
    VALUES ('club', 'legacy', 'CREATED');`);

describe('audit_http_operations migration', () => {
  dbIt(
    'adds source/request_context with backfill-free defaults and the created_at index',
    async () => {
      if (!databaseUrl) throw new Error('integration URL required');
      const schema = `audit_http_${randomBytes(6).toString('hex')}`;
      const client = new Client({ connectionString: databaseUrl });
      await client.connect();
      try {
        await createLegacyAuditLogs(client, schema);
        await client.query(
          `SET search_path=${schema},public; ${durableMigration} ${httpAuditMigration}`,
        );

        // Pre-existing rows keep the 'service' default and a null context.
        await expect(
          client.query(`SELECT source, request_context
          FROM audit_logs WHERE entity_id = 'legacy'`),
        ).resolves.toMatchObject({
          rows: [{ source: 'service', request_context: null }],
        });

        await expect(
          client.query(`INSERT INTO audit_logs (
            entity_type, entity_id, action, source, request_context, result, actor_kind
          ) VALUES (
            'clubs', '42', 'UPDATED', 'http',
            '{"method": "PATCH", "status_code": 200}', 'succeeded', 'user'
          )`),
        ).resolves.toBeDefined();
        await expect(
          client.query(`SELECT source, request_context
          FROM audit_logs WHERE entity_id = '42'`),
        ).resolves.toMatchObject({
          rows: [
            {
              source: 'http',
              request_context: { method: 'PATCH', status_code: 200 },
            },
          ],
        });

        await expect(
          client.query(`INSERT INTO audit_logs (entity_type, entity_id, action, source)
          VALUES ('clubs', 'over-limit', 'UPDATED', repeat('s', 25))`),
        ).rejects.toMatchObject({ code: '22001' });

        await expect(
          client.query(`SELECT indexname FROM pg_indexes
          WHERE schemaname = current_schema() AND tablename = 'audit_logs'
            AND indexname = 'idx_audit_logs_created'`),
        ).resolves.toMatchObject({
          rows: [{ indexname: 'idx_audit_logs_created' }],
        });
      } finally {
        await client.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
        await client.end();
      }
    },
  );
});
