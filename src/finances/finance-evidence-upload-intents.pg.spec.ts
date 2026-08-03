import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Client } from 'pg';

const safeHosts = new Set(['localhost', '127.0.0.1', '::1', '/tmp']);
const normalizeHost = (host: string) =>
  host.startsWith('[') && host.endsWith(']') ? host.slice(1, -1) : host;
const databaseUrl = (() => {
  if (process.env.ALLOW_FINANCE_LEDGER_INTEGRATION_DB !== '1') return;
  const value = process.env.FINANCE_LEDGER_INTEGRATION_DATABASE_URL;
  if (!value) throw new Error('finance upload intent database URL is required');
  const url = new URL(value);
  const requestedHost = url.searchParams.get('host');
  if (
    !['postgres:', 'postgresql:'].includes(url.protocol) ||
    !safeHosts.has(normalizeHost(url.hostname)) ||
    url.searchParams.get('finance_ledger_scratch') !== '1' ||
    (requestedHost && !safeHosts.has(normalizeHost(requestedHost)))
  )
    throw new Error('unsafe finance upload intent database URL');
  url.searchParams.delete('finance_ledger_scratch');
  const client = new Client({ connectionString: url.toString() });
  if (!safeHosts.has(normalizeHost(client.connectionParameters.host)))
    throw new Error('unsafe effective finance upload intent database host');
  return url.toString();
})();
const dbIt = databaseUrl ? it : it.skip;
const safetyIt = databaseUrl ? it.skip : it;
const actor = '00000000-0000-0000-0000-000000000001';
const otherActor = '00000000-0000-0000-0000-000000000002';
const firstHandle = '11111111-1111-4111-8111-111111111111';
const secondHandle = '22222222-2222-4222-8222-222222222222';
const thirdHandle = '33333333-3333-4333-8333-333333333333';
const requestHash = 'a'.repeat(64);
const intents = 'finance_ledger_evidence_upload_intents';

const close = async (client: Client, schema?: string) => {
  if (schema) {
    await client.query('ROLLBACK').catch(() => undefined);
    await client.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    const result = await client.query('SELECT to_regnamespace($1) AS schema', [
      schema,
    ]);
    if (result.rows[0].schema)
      throw new Error('finance upload scratch cleanup failed');
  }
  await client.end().catch(() => undefined);
};
const setup = async () => {
  if (!databaseUrl)
    throw new Error('explicit finance upload intent URL required');
  const schema = `finance_upload_intent_${randomBytes(6).toString('hex')}`;
  const client = new Client({ connectionString: databaseUrl });
  try {
    await client.connect();
    await client.query(
      `CREATE SCHEMA ${schema}; SET search_path TO "${schema}"; CREATE TABLE users (user_id UUID PRIMARY KEY); INSERT INTO users VALUES ('${actor}'),('${otherActor}'); CREATE TABLE club_sections (club_section_id INT PRIMARY KEY, main_club_id INT); INSERT INTO club_sections VALUES (7,1),(8,2); CREATE TABLE finance_ledger_evidence (finance_ledger_evidence_id UUID PRIMARY KEY);`,
    );
    await client.query(
      readFileSync(
        join(
          process.cwd(),
          'prisma/migrations/20260803210000_finance_ledger_evidence_upload_intents/migration.sql',
        ),
        'utf8',
      ),
    );
    return { client, schema };
  } catch (error) {
    await close(client, schema).catch(() => undefined);
    throw error;
  }
};
const insertIssued = (
  client: Client,
  handle = firstHandle,
  idempotencyKey = firstHandle,
  hash = requestHash,
) =>
  client.query(
    `INSERT INTO ${intents} (finance_ledger_evidence_upload_intent_id,actor_user_id,club_id,club_section_id,idempotency_key,request_hash,expected_mime_type,expected_file_size,expires_at) VALUES ($1,$2,1,7,$3,$4,'image/png',10,CURRENT_TIMESTAMP + interval '5 minutes')`,
    [handle, actor, idempotencyKey, hash],
  );
const rejects = (query: Promise<unknown>, code = '23514') =>
  expect(query).rejects.toMatchObject({ code });
const updateIntent = (
  client: Client,
  set: string,
  values: unknown[] = [],
  handle = firstHandle,
) =>
  client.query(
    `UPDATE ${intents} SET ${set} WHERE finance_ledger_evidence_upload_intent_id=$${values.length + 1}`,
    [...values, handle],
  );
const rejectsUpdate = (
  client: Client,
  set: string,
  values: unknown[] = [],
  handle = firstHandle,
  code = '23514',
) => rejects(updateIntent(client, set, values, handle), code);

describe('finance ledger evidence upload intents migration', () => {
  safetyIt('fails closed without explicit safe local opt-in', () => {
    expect(databaseUrl).toBeUndefined();
  });

  dbIt(
    'enforces durable issued-to-completed lifecycle, scope and lease constraints',
    async () => {
      const { client, schema } = await setup();
      try {
        await insertIssued(client);
        const stored = await client.query(
          `SELECT storage_key FROM ${intents} WHERE finance_ledger_evidence_upload_intent_id=$1`,
          [firstHandle],
        );
        expect(stored.rows[0].storage_key).toBe(
          `finance-ledger/1/7/${firstHandle}`,
        );
        await rejectsUpdate(
          client,
          'finance_ledger_evidence_upload_intent_id=$1',
          [secondHandle],
        );
        await rejectsUpdate(client, 'idempotency_key=$1,request_hash=$2', [
          secondHandle,
          'b'.repeat(64),
        ]);
        await updateIntent(
          client,
          `status='verifying',verification_token=$1,verification_expires_at=CURRENT_TIMESTAMP + interval '1 minute'`,
          [secondHandle],
        );
        await client.query(
          `INSERT INTO finance_ledger_evidence VALUES ('${secondHandle}')`,
        );
        await rejectsUpdate(
          client,
          `status='completed',finance_ledger_evidence_id=$1,completed_at=expires_at + interval '1 second'`,
          [secondHandle],
        );
        await updateIntent(
          client,
          `status='completed',finance_ledger_evidence_id=$1`,
          [secondHandle],
        );
        await rejectsUpdate(client, `status='verifying'`);
        await rejectsUpdate(client, 'actor_user_id=$1', [otherActor]);
        await rejectsUpdate(client, 'club_section_id=8,club_id=2');
        await rejects(insertIssued(client), '23505');
        await rejects(
          insertIssued(client, thirdHandle, firstHandle, 'b'.repeat(64)),
          '23505',
        );
        await insertIssued(client, thirdHandle, thirdHandle);
        await updateIntent(
          client,
          `status='verifying',verification_token=$1,verification_expires_at=CURRENT_TIMESTAMP + interval '1 minute'`,
          ['44444444-4444-4444-8444-444444444444'],
          thirdHandle,
        );
        await rejectsUpdate(
          client,
          `status='completed',finance_ledger_evidence_id=$1`,
          [secondHandle],
          thirdHandle,
          '23505',
        );
      } finally {
        await close(client, schema);
      }
    },
  );

  dbIt(
    'rejects invalid issuance and leases, revokes fail-closed, and rolls back',
    async () => {
      const { client, schema } = await setup();
      try {
        await rejects(
          client.query(
            `INSERT INTO ${intents} (finance_ledger_evidence_upload_intent_id,actor_user_id,club_id,club_section_id,idempotency_key,request_hash,storage_key,expected_mime_type,expected_file_size,expires_at) VALUES ($1,$2,1,7,$1,$3,'finance-ledger/client-key','image/png',10,CURRENT_TIMESTAMP + interval '5 minutes')`,
            [firstHandle, actor, requestHash],
          ),
          '428C9',
        );
        await insertIssued(client);
        await rejectsUpdate(client, `status='expired'`);
        await rejectsUpdate(
          client,
          `status='verifying',verification_token=$1,verification_expires_at=expires_at + interval '1 second'`,
          [secondHandle],
        );
        await updateIntent(
          client,
          `status='verifying',verification_token=$1,verification_expires_at=CURRENT_TIMESTAMP + interval '0.001 seconds'`,
          [secondHandle],
        );
        await client.query('SELECT pg_sleep(0.01)');
        await updateIntent(
          client,
          `verification_token=$1,verification_expires_at=CURRENT_TIMESTAMP + interval '1 minute'`,
          [thirdHandle],
        );
        await rejectsUpdate(
          client,
          `status='revoked',verification_token=NULL,verification_expires_at=NULL,revoked_at=expires_at + interval '1 second'`,
        );
        await updateIntent(
          client,
          `status='revoked',verification_token=NULL,verification_expires_at=NULL`,
        );
        await rejectsUpdate(
          client,
          `status='completed',finance_ledger_evidence_id=$1`,
          [secondHandle],
        );
        await client.query('BEGIN');
        await rejects(insertIssued(client, firstHandle), '23505');
        await client.query('ROLLBACK');
        const rows = await client.query(
          `SELECT count(*)::int AS intents,bool_and(revoked_at IS NOT NULL AND revoked_at <= expires_at) AS timestamp_ok FROM ${intents}`,
        );
        expect(rows.rows).toEqual([{ intents: 1, timestamp_ok: true }]);
      } finally {
        await close(client, schema);
      }
    },
  );
});
