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
    '20260730180000_durable_audit_logs',
    'migration.sql',
  ),
  'utf8',
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

describe('durable audit_logs migration', () => {
  dbIt(
    'rolls back the audit expansion cleanly when it fails before commit',
    async () => {
      if (!databaseUrl) throw new Error('integration URL required');
      const schema = `be03c_rollback_${randomBytes(6).toString('hex')}`;
      const client = new Client({ connectionString: databaseUrl });
      await client.connect();
      try {
        await createLegacyAuditLogs(client, schema);
        await expect(
          client.query(
            `SET search_path=${schema},public; ${migration.replace('COMMIT;', 'SELECT 1 / 0; COMMIT;')}`,
          ),
        ).rejects.toMatchObject({ code: '22012' });
        await client.query('ROLLBACK');
        await expect(
          client.query(`SELECT character_maximum_length
          FROM information_schema.columns
          WHERE table_schema = current_schema() AND table_name = 'audit_logs' AND column_name = 'action'`),
        ).resolves.toMatchObject({ rows: [{ character_maximum_length: 20 }] });
        await expect(
          client.query(`SELECT count(*)::int AS count
          FROM information_schema.columns
          WHERE table_schema = current_schema() AND table_name = 'audit_logs'
            AND column_name IN ('event_key', 'actor_scope', 'target_scope', 'effective_at', 'correlation_id', 'idempotency_key', 'result')`),
        ).resolves.toMatchObject({ rows: [{ count: 0 }] });
      } finally {
        await client.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
        await client.end();
      }
    },
  );

  dbIt(
    'preserves legacy rows and enforces durable audit event invariants',
    async () => {
      if (!databaseUrl) throw new Error('integration URL required');
      const schema = `be03c_audit_${randomBytes(6).toString('hex')}`;
      const client = new Client({ connectionString: databaseUrl });
      await client.connect();
      try {
        await createLegacyAuditLogs(client, schema);
        await client.query(`SET search_path=${schema},public; ${migration}`);

        await expect(
          client.query(`SELECT action, actor_kind, result
          FROM audit_logs WHERE entity_id = 'legacy'`),
        ).resolves.toMatchObject({
          rows: [
            { action: 'CREATED', actor_kind: 'user', result: 'succeeded' },
          ],
        });
        await expect(
          client.query(`INSERT INTO audit_logs (
          entity_type, entity_id, action, event_key, actor_user_id, actor_role_name,
          actor_scope, target_user_id, target_scope, effective_at, correlation_id,
          idempotency_key, result, changes
        ) VALUES (
          'director_succession', 'plan-1', 'DIRECTOR_SUCCESSION_SCHEDULED', 'director-succession.scheduled',
          '00000000-0000-0000-0000-000000000001', 'director-lf',
          '{"local_field_id": 1}', '00000000-0000-0000-0000-000000000002',
          '{"club_section_id": 5}', '2027-01-01T00:00:00Z',
          '00000000-0000-0000-0000-000000000003', 'schedule-1', 'succeeded',
          '{"before": {"director": "old"}, "after": {"director": "new"}}'
        )`),
        ).resolves.toBeDefined();
        await expect(
          client.query(`SELECT action, event_key, actor_scope, target_scope, effective_at,
          correlation_id, idempotency_key, result
          FROM audit_logs WHERE entity_id = 'plan-1'`),
        ).resolves.toMatchObject({
          rows: [
            {
              action: 'DIRECTOR_SUCCESSION_SCHEDULED',
              event_key: 'director-succession.scheduled',
              actor_scope: { local_field_id: 1 },
              target_scope: { club_section_id: 5 },
              idempotency_key: 'schedule-1',
              result: 'succeeded',
            },
          ],
        });
        await expect(
          client.query(`INSERT INTO audit_logs (entity_type, entity_id, action, event_key)
          VALUES ('director_succession', 'plan-2', 'DIRECTOR_SUCCESSION_SCHEDULED', 'director-succession.scheduled')`),
        ).rejects.toMatchObject({
          code: '23505',
          constraint: 'audit_logs_event_key_key',
        });
        await expect(
          client.query(`INSERT INTO audit_logs (entity_type, entity_id, action)
          VALUES ('director_succession', 'legacy-null-1', 'DIRECTOR_SUCCESSION_ACTIVATED'),
            ('director_succession', 'legacy-null-2', 'DIRECTOR_SUCCESSION_ACTIVATED')`),
        ).resolves.toBeDefined();
        await expect(
          client.query(`INSERT INTO audit_logs (entity_type, entity_id, action)
          VALUES ('director_succession', 'action-at-limit', repeat('a', 64))`),
        ).resolves.toBeDefined();
        await expect(
          client.query(`INSERT INTO audit_logs (entity_type, entity_id, action)
          VALUES ('director_succession', 'action-over-limit', repeat('a', 65))`),
        ).rejects.toMatchObject({ code: '22001' });
        await expect(
          client.query(`INSERT INTO audit_logs (entity_type, entity_id, action, event_key)
          VALUES ('director_succession', 'too-long', 'DIRECTOR_SUCCESSION_ACTIVATED', repeat('x', 161))`),
        ).rejects.toMatchObject({ code: '22001' });
        await expect(
          client.query(`SELECT indexname FROM pg_indexes
          WHERE schemaname = current_schema() AND tablename = 'audit_logs'
            AND indexname IN (
              'idx_audit_logs_actor_created', 'idx_audit_logs_target_created',
              'idx_audit_logs_action_created', 'idx_audit_logs_correlation_id'
            ) ORDER BY indexname`),
        ).resolves.toMatchObject({
          rows: [
            { indexname: 'idx_audit_logs_action_created' },
            { indexname: 'idx_audit_logs_actor_created' },
            { indexname: 'idx_audit_logs_correlation_id' },
            { indexname: 'idx_audit_logs_target_created' },
          ],
        });
      } finally {
        await client.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
        await client.end();
      }
    },
  );
});
