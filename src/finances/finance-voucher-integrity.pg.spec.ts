import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Client } from 'pg';

const allowedDatabaseHosts = new Set(['localhost', '127.0.0.1', '::1', '/tmp']);
const normalizeDatabaseHost = (host: string) =>
  host.startsWith('[') && host.endsWith(']') ? host.slice(1, -1) : host;

const resolveFinanceDatabaseUrl = (
  value: string | undefined,
  allowed = process.env.ALLOW_FINANCE_LEDGER_INTEGRATION_DB === '1',
) => {
  if (!allowed) return undefined;
  if (!value) throw new Error('finance integration database URL is required');
  try {
    const url = new URL(value);
    if (
      !['postgres:', 'postgresql:'].includes(url.protocol) ||
      !allowedDatabaseHosts.has(normalizeDatabaseHost(url.hostname)) ||
      url.searchParams.get('finance_ledger_scratch') !== '1'
    )
      throw new Error('unsafe finance integration database URL');
    const requestedHost = url.searchParams.get('host');
    if (
      requestedHost &&
      !allowedDatabaseHosts.has(normalizeDatabaseHost(requestedHost))
    )
      throw new Error('unsafe finance integration database host');
    url.searchParams.delete('finance_ledger_scratch');
    const client = new Client({ connectionString: url.toString() });
    if (
      !allowedDatabaseHosts.has(
        normalizeDatabaseHost(client.connectionParameters.host),
      )
    )
      throw new Error('unsafe effective finance integration database host');
    return url.toString();
  } catch (error) {
    throw error instanceof Error
      ? error
      : new Error('invalid finance integration database URL');
  }
};

const databaseUrl = resolveFinanceDatabaseUrl(
  process.env.FINANCE_LEDGER_INTEGRATION_DATABASE_URL,
);
const dbIt = databaseUrl ? it : it.skip;
const actor = '00000000-0000-0000-0000-000000000001';

const setup = async () => {
  if (!databaseUrl)
    throw new Error('explicit finance integration URL required');
  const schema = `finance_voucher_integrity_${randomBytes(6).toString('hex')}`;
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    await client.query(
      `CREATE SCHEMA ${schema}; SET search_path TO "${schema}"`,
    );
    // prettier-ignore
    await client.query(`CREATE TABLE users (user_id UUID PRIMARY KEY); INSERT INTO users VALUES ('${actor}'); CREATE TABLE club_sections (club_section_id INT PRIMARY KEY, main_club_id INT); INSERT INTO club_sections VALUES (7,1); CREATE TABLE finances (finance_id INT PRIMARY KEY); CREATE TABLE finances_categories (finance_category_id INT PRIMARY KEY, type INT NOT NULL, active BOOLEAN NOT NULL); INSERT INTO finances_categories VALUES (11,1,true); CREATE TABLE system_config (config_key TEXT PRIMARY KEY, config_value TEXT NOT NULL); CREATE TABLE audit_logs (entity_type TEXT,entity_id UUID,action TEXT,club_id INT,actor_user_id UUID,changes JSONB,event_key TEXT UNIQUE,correlation_id TEXT,idempotency_key TEXT); CREATE TABLE finance_evidence_files (finance_evidence_file_id INT PRIMARY KEY);`);
    await client.query(
      readFileSync(
        join(
          process.cwd(),
          'prisma/migrations/20260730200000_finance_ledger_v2_foundation/migration.sql',
        ),
        'utf8',
      ),
    );
    await client.query(
      readFileSync(
        join(
          process.cwd(),
          'prisma/migrations/20260803184000_finance_voucher_integrity/migration.sql',
        ),
        'utf8',
      ),
    );
    await client.query(
      `INSERT INTO finance_ledger_entries (club_section_id,finance_category_id,kind,amount_centavos,currency,finance_date,status,registered_by_id,decided_by_id,decided_at) VALUES (7,11,'income',10000,'MXN','2026-08-03','approved','${actor}','${actor}',CURRENT_TIMESTAMP); INSERT INTO finance_ledger_evidence (club_section_id,storage_key,mime_type,file_size,content_sha256,created_by_id) VALUES (7,'finance-ledger/receipt-1.pdf','application/pdf',512,repeat('a',64),'${actor}');`,
    );
    return { client, schema };
  } catch (error) {
    await client.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    await client.end();
    throw error;
  }
};

const close = async (client: Client, schema: string) => {
  await client
    .query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`)
    .catch(() => undefined);
  await client.end().catch(() => undefined);
};

describe('finance voucher integrity migration', () => {
  it('fails closed without explicit safe local opt-in', () => {
    expect(resolveFinanceDatabaseUrl(undefined, false)).toBeUndefined();
    for (const value of [
      undefined,
      'not-a-url',
      'postgresql://abner@localhost/postgres?finance_ledger_scratch=0',
      'postgresql://abner@evil.example/postgres?finance_ledger_scratch=1',
    ])
      expect(() => resolveFinanceDatabaseUrl(value, true)).toThrow();
  });

  dbIt(
    'enforces one event target, exact approved-entry value, global evidence dedupe, and rollback',
    async () => {
      const { client, schema } = await setup();
      try {
        const entryId = (
          await client.query(
            'SELECT finance_ledger_entry_id FROM finance_ledger_entries',
          )
        ).rows[0].finance_ledger_entry_id;
        const evidenceId = (
          await client.query(
            'SELECT finance_ledger_evidence_id FROM finance_ledger_evidence',
          )
        ).rows[0].finance_ledger_evidence_id;
        const voucherId = (
          await client.query(
            `INSERT INTO finance_vouchers (ledger_entry_id,finance_ledger_evidence_id,amount_centavos,currency,source_uri,file_name,mime_type,file_size,recorded_by_id) VALUES ($1,$2,10000,'MXN','finance-ledger/receipt-1.pdf','receipt-1.pdf','application/pdf',512,$3) RETURNING finance_voucher_id`,
            [entryId, evidenceId, actor],
          )
        ).rows[0].finance_voucher_id;

        await client.query(
          `INSERT INTO finance_ledger_events (finance_voucher_id,event_type,actor_user_id,payload) VALUES ($1,'VOUCHER_ATTACHED',$2,jsonb_build_object('entry_id',$3::text))`,
          [voucherId, actor, entryId],
        );
        await expect(
          client.query(
            `INSERT INTO finance_ledger_events (finance_ledger_entry_id,finance_voucher_id,event_type,actor_user_id,payload) VALUES ($1,$2,'VOUCHER_ATTACHED',$3,'{}')`,
            [entryId, voucherId, actor],
          ),
        ).rejects.toMatchObject({ code: '23514' });

        await client.query('BEGIN');
        await expect(
          client.query(
            `INSERT INTO finance_vouchers (ledger_entry_id,amount_centavos,currency,source_uri,file_name,mime_type,recorded_by_id) VALUES ($1,10001,'MXN','finance-ledger/receipt-2.pdf','receipt-2.pdf','application/pdf',$2)`,
            [entryId, actor],
          ),
        ).rejects.toMatchObject({ code: '23514' });
        await client.query('ROLLBACK');
        await expect(
          client.query(
            `INSERT INTO finance_ledger_evidence (club_section_id,storage_key,mime_type,file_size,content_sha256,created_by_id) VALUES (7,'finance-ledger/duplicate.pdf','application/pdf',512,repeat('a',64),$1)`,
            [actor],
          ),
        ).rejects.toMatchObject({ code: '23505' });
        await expect(
          client.query(
            `SELECT (SELECT count(*)::int FROM finance_vouchers) vouchers, (SELECT count(*)::int FROM finance_ledger_events) events`,
          ),
        ).resolves.toMatchObject({ rows: [{ vouchers: 1, events: 1 }] });
      } finally {
        await close(client, schema);
      }
    },
  );
});
