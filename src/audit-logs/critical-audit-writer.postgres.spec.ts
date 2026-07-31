import { randomBytes } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { Client } from 'pg';
import { ErrorCode } from '../common/errors/error-codes';
import { classifyLocalFieldTimezone } from '../common/validators/iana-timezone.validator';
import {
  CriticalAuditEvent,
  CriticalAuditWriterService,
} from './critical-audit-writer.service';

const databaseUrl = process.env.AUTHORIZATION_P0_INTEGRATION_DATABASE_URL;
const pgIt =
  process.env.ALLOW_AUTHORIZATION_P0_INTEGRATION_DB === '1' && databaseUrl
    ? it
    : it.skip;
const timezone = classifyLocalFieldTimezone('America/Mexico_City');
if (!timezone.ok) throw new Error('test timezone must be canonical');

const event = (eventKey = 'critical-audit:request-1'): CriticalAuditEvent => ({
  entityType: 'club_role_assignment',
  entityId: 'assignment-1',
  action: 'CLUB_ROLE_ASSIGNED',
  eventKey,
  actor: {
    kind: 'user',
    userId: '00000000-0000-0000-0000-000000000001',
    roleName: 'director',
    scope: {
      local_field_id: 10,
      actor_assignment_id: 'assignment-director-1',
    },
  },
  target: {
    userId: '00000000-0000-0000-0000-000000000002',
    scope: {
      local_field_id: 10,
      club_section_id: 20,
      target_role_name: 'secretary',
    },
  },
  before: { role: null },
  after: { role: 'secretary' },
  effectiveAt: new Date('2026-10-01T05:00:00.000Z'),
  temporal: {
    businessDate: '2026-10-01',
    businessTimezone: timezone.value,
  },
  correlationId: '00000000-0000-0000-0000-000000000003',
  idempotencyKey: 'request-1',
});

const createAuditLogs = (client: Client, schema: string) =>
  client.query(`CREATE SCHEMA ${schema}; SET search_path=${schema},public;
    CREATE TABLE audit_logs (
      audit_log_id BIGSERIAL PRIMARY KEY,
      entity_type VARCHAR(50) NOT NULL,
      entity_id VARCHAR(64) NOT NULL,
      action VARCHAR(64) NOT NULL,
      event_key VARCHAR(160) UNIQUE,
      club_id INT,
      summary VARCHAR(500),
      actor_user_id UUID,
      actor_kind VARCHAR(24) NOT NULL DEFAULT 'user',
      actor_role_name VARCHAR(64),
      actor_scope JSONB,
      target_user_id UUID,
      target_scope JSONB,
      effective_at TIMESTAMPTZ,
      correlation_id UUID,
      idempotency_key VARCHAR(128),
      result VARCHAR(32) NOT NULL DEFAULT 'succeeded',
      changes JSONB,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE TABLE audit_probe (probe_id INT PRIMARY KEY);`);

const auditTx = (client: Client) =>
  ({
    $queryRaw: (query: Prisma.Sql) => client.query(query.text, query.values),
    audit_logs: {
      findUnique: async ({ where }: { where: { event_key: string } }) => {
        const result = await client.query(
          `SELECT audit_log_id, entity_type, entity_id, action, event_key, club_id,
            summary, actor_user_id, actor_kind, actor_role_name, actor_scope,
            target_user_id, target_scope, effective_at, correlation_id,
            idempotency_key, result, changes
          FROM audit_logs WHERE event_key = $1`,
          [where.event_key],
        );
        const row = result.rows[0];
        return row === undefined
          ? null
          : { ...row, audit_log_id: BigInt(row.audit_log_id) };
      },
      create: async ({ data }: { data: Record<string, unknown> }) => {
        const result = await client.query(
          `INSERT INTO audit_logs (
            entity_type, entity_id, action, event_key, club_id, summary,
            actor_user_id, actor_kind, actor_role_name, actor_scope,
            target_user_id, target_scope, effective_at, correlation_id,
            idempotency_key, result, changes
          ) VALUES (
            $1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11,$12::jsonb,$13,$14,$15,$16,$17::jsonb
          ) RETURNING audit_log_id`,
          [
            data.entity_type,
            data.entity_id,
            data.action,
            data.event_key,
            data.club_id,
            data.summary,
            data.actor_user_id,
            data.actor_kind,
            data.actor_role_name,
            JSON.stringify(data.actor_scope),
            data.target_user_id,
            JSON.stringify(data.target_scope),
            data.effective_at,
            data.correlation_id,
            data.idempotency_key,
            data.result,
            JSON.stringify(data.changes),
          ],
        );
        return { audit_log_id: BigInt(result.rows[0].audit_log_id) };
      },
    },
  }) as Parameters<CriticalAuditWriterService['write']>[0];

const connect = async (schema: string) => {
  if (!databaseUrl) throw new Error('integration URL required');
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  await client.query(`SET search_path=${schema},public`);
  return client;
};

const expectedSnapshot = (source = event()) => ({
  actor_user_id: source.actor.userId,
  target_user_id: source.target.userId,
  actor_scope: source.actor.scope,
  target_scope: source.target.scope,
  effective_at: source.effectiveAt,
  changes: {
    before: { role: null },
    after: { role: 'secretary' },
    temporal: {
      business_date: '2026-10-01',
      business_timezone: 'America/Mexico_City',
    },
  },
});

const expectExactSnapshot = (actual: unknown) =>
  expect(actual).toEqual(expectedSnapshot());

describe('CriticalAuditWriterService PostgreSQL fixture', () => {
  it('mutation probe rejects swapped actor and target scopes', () => {
    const snapshot = expectedSnapshot();
    expect(() =>
      expectExactSnapshot({
        ...snapshot,
        actor_scope: snapshot.target_scope,
        target_scope: snapshot.actor_scope,
      }),
    ).toThrow();
  });

  it('mutation probe rejects a missing effective_at', () => {
    expect(() =>
      expectExactSnapshot({ ...expectedSnapshot(), effective_at: null }),
    ).toThrow();
  });

  pgIt(
    'uses the supplied transaction and persists distinct actor/target scopes with a temporal snapshot',
    async () => {
      if (!databaseUrl) throw new Error('integration URL required');
      const schema = `critical_audit_${randomBytes(6).toString('hex')}`;
      const admin = new Client({ connectionString: databaseUrl });
      await admin.connect();
      try {
        await createAuditLogs(admin, schema);
        const client = await connect(schema);
        try {
          await client.query('BEGIN');
          const writer = new CriticalAuditWriterService();
          await expect(writer.write(auditTx(client), event())).resolves.toEqual(
            {
              auditLogId: 1n,
              replayed: false,
            },
          );
          await client.query('COMMIT');
          const persisted = await client.query(`SELECT actor_user_id,
            target_user_id, actor_scope, target_scope, effective_at, changes
            FROM audit_logs`);
          expect(persisted.rows).toHaveLength(1);
          expectExactSnapshot(persisted.rows[0]);
        } finally {
          await client.end();
        }
      } finally {
        await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
        await admin.end();
      }
    },
  );

  pgIt(
    'rolls back the caller transaction completely when audit persistence fails',
    async () => {
      if (!databaseUrl) throw new Error('integration URL required');
      const schema = `critical_audit_rollback_${randomBytes(6).toString('hex')}`;
      const admin = new Client({ connectionString: databaseUrl });
      await admin.connect();
      try {
        await createAuditLogs(admin, schema);
        const client = await connect(schema);
        try {
          await client.query('BEGIN');
          await client.query('INSERT INTO audit_probe VALUES (1)');
          await expect(
            new CriticalAuditWriterService().write(
              auditTx(client),
              event('x'.repeat(161)),
            ),
          ).rejects.toMatchObject({ code: '22001' });
          await client.query('ROLLBACK');
          await expect(
            client.query('SELECT * FROM audit_probe'),
          ).resolves.toMatchObject({
            rows: [],
          });
          await expect(
            client.query('SELECT * FROM audit_logs'),
          ).resolves.toMatchObject({
            rows: [],
          });
        } finally {
          await client.end();
        }
      } finally {
        await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
        await admin.end();
      }
    },
  );

  pgIt(
    'serializes concurrent replay and fails closed on an incompatible event-key reuse',
    async () => {
      if (!databaseUrl) throw new Error('integration URL required');
      const schema = `critical_audit_race_${randomBytes(6).toString('hex')}`;
      const admin = new Client({ connectionString: databaseUrl });
      await admin.connect();
      try {
        await createAuditLogs(admin, schema);
        const first = await connect(schema);
        const second = await connect(schema);
        try {
          const writer = new CriticalAuditWriterService();
          await first.query('BEGIN');
          await expect(
            writer.write(auditTx(first), event()),
          ).resolves.toMatchObject({
            replayed: false,
          });
          await second.query('BEGIN');
          const concurrentReplay = writer.write(auditTx(second), event());
          await first.query('COMMIT');
          await expect(concurrentReplay).resolves.toMatchObject({
            replayed: true,
          });
          await second.query('COMMIT');

          await second.query('BEGIN');
          await expect(
            writer.write(auditTx(second), {
              ...event(),
              after: { role: 'treasurer' },
            }),
          ).rejects.toMatchObject({ code: ErrorCode.AUDIT_WRITE_FAILED });
          await second.query('ROLLBACK');
        } finally {
          await first.end();
          await second.end();
        }
      } finally {
        await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
        await admin.end();
      }
    },
  );
});
