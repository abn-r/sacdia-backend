import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Client } from 'pg';
import { FinanceLedgerService } from './finance-ledger.service';

const safeHosts = new Set(['localhost', '127.0.0.1', '::1', '/tmp']);
const normalizeHost = (host: string) =>
  host.startsWith('[') && host.endsWith(']') ? host.slice(1, -1) : host;
const databaseUrl = (() => {
  if (process.env.ALLOW_FINANCE_LEDGER_INTEGRATION_DB !== '1') return;
  const value = process.env.FINANCE_LEDGER_INTEGRATION_DATABASE_URL;
  if (!value)
    throw new Error('finance allocation integration database URL is required');
  const url = new URL(value);
  const requestedHost = url.searchParams.get('host');
  if (
    !['postgres:', 'postgresql:'].includes(url.protocol) ||
    !safeHosts.has(normalizeHost(url.hostname)) ||
    url.searchParams.get('finance_ledger_scratch') !== '1' ||
    (requestedHost && !safeHosts.has(normalizeHost(requestedHost)))
  )
    throw new Error('unsafe finance allocation integration database URL');
  url.searchParams.delete('finance_ledger_scratch');
  const client = new Client({ connectionString: url.toString() });
  if (!safeHosts.has(normalizeHost(client.connectionParameters.host)))
    throw new Error('unsafe effective finance allocation integration host');
  return url.toString();
})();
const dbIt = databaseUrl ? it : it.skip;
const actor = '00000000-0000-0000-0000-000000000001';
const entryColumns =
  'finance_ledger_entry_id,club_section_id,status,kind,amount_centavos,currency';
const one = <T>(result: { rows: T[] }) => result.rows[0];

class AllocationPgAdapter {
  failAt?: 'allocation' | 'event' | 'audit' | 'receipt';
  constructor(readonly client: Client) {}
  async $transaction<T>(callback: (tx: this) => Promise<T>) {
    await this.client.query('BEGIN');
    try {
      const result = await callback(this);
      await this.client.query('COMMIT');
      return result;
    } catch (error) {
      await this.client.query('ROLLBACK');
      throw error;
    }
  }
  $executeRaw = (sql: { text: string; values: unknown[] }) =>
    this.client.query(sql.text, sql.values);
  system_config = {
    findUnique: async ({ where: { config_key } }: any) =>
      one(
        await this.client.query(
          'SELECT * FROM system_config WHERE config_key=$1',
          [config_key],
        ),
      ),
  };
  finance_idempotency_receipts = {
    findUnique: async ({
      where: { actor_user_id_idempotency_key: key },
    }: any) =>
      one(
        await this.client.query(
          'SELECT * FROM finance_idempotency_receipts WHERE actor_user_id=$1 AND idempotency_key=$2',
          [key.actor_user_id, key.idempotency_key],
        ),
      ),
    create: async ({ data }: any) => {
      if (this.failAt === 'receipt') throw new Error('receipt failure');
      return one(
        await this.client.query(
          'INSERT INTO finance_idempotency_receipts(actor_user_id,idempotency_key,command,request_hash,response) VALUES($1,$2,$3,$4,$5::jsonb) RETURNING *',
          [
            data.actor_user_id,
            data.idempotency_key,
            data.command,
            data.request_hash,
            JSON.stringify(data.response),
          ],
        ),
      );
    },
  };
  finance_vouchers = {
    findUnique: async ({ where: { finance_voucher_id } }: any) => {
      const voucher = one(
        await this.client.query(
          `SELECT v.finance_voucher_id,v.amount_centavos,v.currency,e.status,e.club_section_id FROM finance_vouchers v JOIN finance_ledger_entries e ON e.finance_ledger_entry_id=v.ledger_entry_id WHERE v.finance_voucher_id=$1`,
          [finance_voucher_id],
        ),
      );
      return (
        voucher && {
          ...voucher,
          ledger_entry: {
            status: voucher.status,
            club_section_id: voucher.club_section_id,
          },
        }
      );
    },
  };
  finance_ledger_entries = {
    findUnique: async ({ where: { finance_ledger_entry_id } }: any) =>
      one(
        await this.client.query(
          `SELECT ${entryColumns} FROM finance_ledger_entries WHERE finance_ledger_entry_id=$1`,
          [finance_ledger_entry_id],
        ),
      ),
  };
  finance_receipt_allocations = {
    aggregate: async ({ where }: any) => ({
      _sum: one(
        await this.client.query(
          `SELECT COALESCE(sum(amount_centavos),0)::int AS amount_centavos FROM finance_receipt_allocations WHERE ${where.finance_voucher_id ? 'finance_voucher_id' : 'obligation_entry_id'}=$1`,
          [where.finance_voucher_id ?? where.obligation_entry_id],
        ),
      ),
    }),
    create: async ({ data }: any) => {
      if (this.failAt === 'allocation') throw new Error('allocation failure');
      try {
        return one(
          await this.client.query(
            'INSERT INTO finance_receipt_allocations(finance_voucher_id,obligation_entry_id,amount_centavos) VALUES($1,$2,$3) RETURNING *',
            [
              data.finance_voucher_id,
              data.obligation_entry_id,
              data.amount_centavos,
            ],
          ),
        );
      } catch (error) {
        if ((error as { code?: string }).code === '23505')
          Object.assign(error as object, { code: 'P2002' });
        throw error;
      }
    },
  };
  finance_ledger_events = {
    create: async ({ data }: any) => {
      if (this.failAt === 'event') throw new Error('event failure');
      return this.client.query(
        'INSERT INTO finance_ledger_events(finance_receipt_allocation_id,event_type,actor_user_id,payload) VALUES($1,$2,$3,$4::jsonb)',
        [
          data.finance_receipt_allocation_id,
          data.event_type,
          data.actor_user_id,
          JSON.stringify(data.payload),
        ],
      );
    },
  };
  audit_logs = {
    create: async ({ data }: any) => {
      if (this.failAt === 'audit') throw new Error('audit failure');
      return this.client.query(
        'INSERT INTO audit_logs(entity_type,entity_id,action,club_id,actor_user_id,changes,event_key,correlation_id,idempotency_key) VALUES($1,$2,$3,$4,$5,$6::jsonb,$7,$8,$9)',
        [
          data.entity_type,
          data.entity_id,
          data.action,
          data.club_id,
          data.actor_user_id,
          JSON.stringify(data.changes),
          data.event_key,
          data.correlation_id,
          data.idempotency_key,
        ],
      );
    },
  };
}

const close = async (client: Client, schema?: string) => {
  if (schema)
    await client
      .query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`)
      .catch(() => undefined);
  await client.end().catch(() => undefined);
};
const setup = async () => {
  if (!databaseUrl) throw new Error('explicit finance allocation URL required');
  const schema = `finance_wu2c3b_${randomBytes(6).toString('hex')}`;
  const client = new Client({ connectionString: databaseUrl });
  try {
    await client.connect();
    await client.query(
      `CREATE SCHEMA ${schema}; SET search_path TO "${schema}"; CREATE TABLE users (user_id UUID PRIMARY KEY); INSERT INTO users VALUES ('${actor}'); CREATE TABLE club_sections (club_section_id INT PRIMARY KEY, main_club_id INT); INSERT INTO club_sections VALUES (7,1); CREATE TABLE finances (finance_id INT PRIMARY KEY); CREATE TABLE finances_categories (finance_category_id INT PRIMARY KEY); INSERT INTO finances_categories VALUES (1); CREATE TABLE system_config (config_key TEXT PRIMARY KEY, config_value TEXT NOT NULL); INSERT INTO system_config VALUES ('finance.ledger_v2_writes_enabled','true'); CREATE TABLE audit_logs (entity_type TEXT,entity_id UUID,action TEXT,club_id INT,actor_user_id UUID,changes JSONB,event_key TEXT UNIQUE,correlation_id TEXT,idempotency_key TEXT);`,
    );
    for (const migration of [
      '20260730200000_finance_ledger_v2_foundation',
      '20260803184000_finance_voucher_integrity',
    ])
      await client.query(
        readFileSync(
          join(process.cwd(), `prisma/migrations/${migration}/migration.sql`),
          'utf8',
        ),
      );
    return { client, schema, db: new AllocationPgAdapter(client) };
  } catch (error) {
    await close(client, schema);
    throw error;
  }
};
const newClient = async (schema: string) => {
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  await client.query(`SET search_path TO "${schema}"`);
  return new AllocationPgAdapter(client);
};
const service = (db: AllocationPgAdapter, authorize = async () => undefined) =>
  new FinanceLedgerService(
    db as any,
    { assertCanRegister: authorize },
    { assertCanDecide: async () => undefined },
    {
      resolveOwnedEvidence: async () => {
        throw new Error('unused');
      },
    },
  );
const seed = async (
  client: Client,
  payableAmounts: number[],
  voucherAmount = 100,
) => {
  const source = one(
    await client.query(
      `INSERT INTO finance_ledger_entries(club_section_id,finance_category_id,kind,amount_centavos,currency,finance_date,status,registered_by_id,decided_by_id,decided_at) VALUES(7,1,'expense',$1,'MXN','2026-08-03','approved',$2,$2,CURRENT_TIMESTAMP) RETURNING finance_ledger_entry_id`,
      [voucherAmount, actor],
    ),
  );
  const voucher = one(
    await client.query(
      `INSERT INTO finance_vouchers(ledger_entry_id,amount_centavos,currency,source_uri,file_name,mime_type,recorded_by_id) VALUES($1,$2,'MXN','finance-ledger/source.pdf','source.pdf','application/pdf',$3) RETURNING finance_voucher_id`,
      [source.finance_ledger_entry_id, voucherAmount, actor],
    ),
  );
  const obligations = [] as string[];
  for (const amount of payableAmounts)
    obligations.push(
      one(
        await client.query(
          `INSERT INTO finance_ledger_entries(club_section_id,finance_category_id,kind,amount_centavos,currency,finance_date,status,registered_by_id,decided_by_id,decided_at) VALUES(7,1,'payable',$1,'MXN','2026-08-03','approved',$2,$2,CURRENT_TIMESTAMP) RETURNING finance_ledger_entry_id`,
          [amount, actor],
        ),
      ).finance_ledger_entry_id,
    );
  return { voucherId: voucher.finance_voucher_id as string, obligations };
};
const request = (
  voucherId: string,
  obligationEntryId: string,
  amountCentavos = 100,
) => ({
  clubId: 1,
  clubSectionId: 7,
  financeVoucherId: voucherId,
  obligationEntryId,
  amountCentavos,
});
const counts = (client: Client) =>
  client.query(
    'SELECT (SELECT count(*)::int FROM finance_receipt_allocations) allocations,(SELECT count(*)::int FROM finance_ledger_events) events,(SELECT count(*)::int FROM audit_logs) audits,(SELECT count(*)::int FROM finance_idempotency_receipts) receipts',
  );

describe('finance receipt allocation PostgreSQL proof', () => {
  dbIt(
    'serializes both capacity dimensions, reauthorizes durable replay, and exposes no negative balance',
    async () => {
      const fixture = await setup();
      let second: AllocationPgAdapter | undefined;
      try {
        const first = await seed(fixture.client, [100, 100]);
        second = await newClient(fixture.schema);
        const firstRace = await Promise.allSettled([
          service(fixture.db).allocateReceipt(
            request(first.voucherId, first.obligations[0]),
            actor,
            '11111111-1111-4111-8111-111111111111',
          ),
          service(second).allocateReceipt(
            request(first.voucherId, first.obligations[1]),
            actor,
            '22222222-2222-4222-8222-222222222222',
          ),
        ]);
        expect(
          firstRace.filter((result) => result.status === 'fulfilled'),
        ).toHaveLength(1);
        const secondSource = await seed(fixture.client, [100]);
        const otherSource = await seed(fixture.client, [100]);
        const secondRace = await Promise.allSettled([
          service(fixture.db).allocateReceipt(
            request(secondSource.voucherId, secondSource.obligations[0]),
            actor,
            '33333333-3333-4333-8333-333333333333',
          ),
          service(second).allocateReceipt(
            request(otherSource.voucherId, secondSource.obligations[0]),
            actor,
            '44444444-4444-4444-8444-444444444444',
          ),
        ]);
        expect(
          secondRace.filter((result) => result.status === 'fulfilled'),
        ).toHaveLength(1);
        let authorizations = 0;
        const replay = service(fixture.db, async () => {
          authorizations += 1;
        });
        const replayed = await replay.allocateReceipt(
          request(otherSource.voucherId, otherSource.obligations[0]),
          actor,
          '55555555-5555-4555-8555-555555555555',
        );
        await expect(
          replay.allocateReceipt(
            request(otherSource.voucherId, otherSource.obligations[0]),
            actor,
            '55555555-5555-4555-8555-555555555555',
          ),
        ).resolves.toEqual(replayed);
        expect(authorizations).toBe(2);
        await expect(
          fixture.client.query(
            "SELECT min(e.amount_centavos-COALESCE(a.used,0))::int AS remaining FROM finance_ledger_entries e LEFT JOIN (SELECT obligation_entry_id,sum(amount_centavos) used FROM finance_receipt_allocations GROUP BY obligation_entry_id) a ON a.obligation_entry_id=e.finance_ledger_entry_id WHERE e.kind='payable'",
          ),
        ).resolves.toMatchObject({ rows: [{ remaining: 0 }] });
      } finally {
        if (second) await close(second.client);
        await close(fixture.client, fixture.schema);
      }
    },
  );

  dbIt(
    'rolls back allocation, event, audit, and receipt failures; maps real pair 23505 generically; and cleans scratch state',
    async () => {
      const fixture = await setup();
      try {
        const { voucherId, obligations } = await seed(
          fixture.client,
          [200],
          200,
        );
        for (const failAt of [
          'allocation',
          'event',
          'audit',
          'receipt',
        ] as const) {
          fixture.db.failAt = failAt;
          await expect(
            service(fixture.db).allocateReceipt(
              request(voucherId, obligations[0], 100),
              actor,
              `${failAt === 'allocation' ? '66666666' : failAt === 'event' ? '77777777' : failAt === 'audit' ? '88888888' : '99999999'}-0000-4000-8000-000000000000`,
            ),
          ).rejects.toThrow(`${failAt} failure`);
          await expect(counts(fixture.client)).resolves.toMatchObject({
            rows: [{ allocations: 0, events: 0, audits: 0, receipts: 0 }],
          });
        }
        fixture.db.failAt = undefined;
        await service(fixture.db).allocateReceipt(
          request(voucherId, obligations[0], 100),
          actor,
          'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        );
        await expect(
          service(fixture.db).allocateReceipt(
            request(voucherId, obligations[0], 100),
            actor,
            'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
          ),
        ).rejects.toMatchObject({ code: 'FINANCE_LEDGER_STATUS_INVALID' });
        await expect(
          fixture.client.query(
            'SELECT count(*)::int events, count(finance_receipt_allocation_id)::int targets FROM finance_ledger_events',
          ),
        ).resolves.toMatchObject({ rows: [{ events: 1, targets: 1 }] });
      } finally {
        await close(fixture.client, fixture.schema);
      }
    },
  );
});
