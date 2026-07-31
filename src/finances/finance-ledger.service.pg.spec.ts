import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Client } from 'pg';
import { FinanceLedgerService } from './finance-ledger.service';

const databaseUrl =
  process.env.FINANCE_LEDGER_INTEGRATION_DATABASE_URL ??
  process.env.AUTHORIZATION_P0_INTEGRATION_DATABASE_URL;
const dbIt =
  (process.env.ALLOW_FINANCE_LEDGER_INTEGRATION_DB === '1' ||
    process.env.ALLOW_AUTHORIZATION_P0_INTEGRATION_DB === '1') &&
  databaseUrl
    ? it
    : it.skip;
const actor = '00000000-0000-0000-0000-000000000001';
const key = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const input = (overrides: Record<string, unknown> = {}) => ({
  clubId: 1,
  clubSectionId: 7,
  financeCategoryId: 11,
  kind: 'expense' as const,
  amountCentavos: 1200,
  currency: 'MXN',
  financeDate: new Date('2026-07-31T00:00:00.000Z'),
  ...overrides,
});

const columns = `"finance_ledger_entry_id","club_section_id","finance_category_id","status","kind","amount_centavos","currency","finance_date","registered_by_id","decided_by_id","decided_at","rejection_reason"`;
const row = (result: { rows: Record<string, unknown>[] }) => result.rows[0];

class LedgerPrismaFixture {
  readonly sectionLocks: number[][] = [];
  failAt?: 'event' | 'audit' | 'receipt';

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

  $queryRaw = async (sql: { text: string; values: unknown[] }) => {
    const result = await this.client.query(sql.text, sql.values);
    this.sectionLocks.push(sql.values as number[]);
    return result.rows;
  };

  system_config = {
    findUnique: async ({ where: { config_key } }: any) =>
      row(
        await this.client.query(
          'SELECT * FROM system_config WHERE config_key=$1',
          [config_key],
        ),
      ),
  };

  finance_idempotency_receipts = {
    findUnique: async ({
      where: { actor_user_id_idempotency_key: identity },
    }: any) =>
      row(
        await this.client.query(
          'SELECT * FROM finance_idempotency_receipts WHERE actor_user_id=$1 AND idempotency_key=$2',
          [identity.actor_user_id, identity.idempotency_key],
        ),
      ),
    create: async ({ data }: any) => {
      if (this.failAt === 'receipt') throw new Error('receipt failure');
      return row(
        await this.client.query(
          `INSERT INTO finance_idempotency_receipts (actor_user_id,idempotency_key,command,request_hash,response)
         VALUES ($1,$2,$3,$4,$5::jsonb) RETURNING *`,
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

  finances_categories = {
    findUnique: async ({ where: { finance_category_id } }: any) =>
      row(
        await this.client.query(
          'SELECT * FROM finances_categories WHERE finance_category_id=$1',
          [finance_category_id],
        ),
      ),
  };
  finance_currencies = {
    findUnique: async ({ where: { currency_code } }: any) =>
      row(
        await this.client.query(
          'SELECT * FROM finance_currencies WHERE currency_code=$1',
          [currency_code],
        ),
      ),
  };

  finance_ledger_entries = {
    create: async ({ data }: any) =>
      row(
        await this.client.query(
          `INSERT INTO finance_ledger_entries (club_section_id,finance_category_id,kind,amount_centavos,currency,finance_date,registered_by_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING ${columns}`,
          [
            data.club_section_id,
            data.finance_category_id,
            data.kind,
            data.amount_centavos,
            data.currency,
            data.finance_date,
            data.registered_by_id,
          ],
        ),
      ),
    findUnique: async ({
      where: { finance_ledger_entry_id },
      include,
    }: any) => {
      const entry = row(
        await this.client.query(
          `SELECT ${columns},s.main_club_id FROM finance_ledger_entries e JOIN club_sections s USING (club_section_id)
         WHERE finance_ledger_entry_id=$1`,
          [finance_ledger_entry_id],
        ),
      );
      return (
        entry &&
        (include
          ? { ...entry, club_section: { main_club_id: entry.main_club_id } }
          : entry)
      );
    },
    update: async ({ where: { finance_ledger_entry_id }, data }: any) =>
      row(
        await this.client.query(
          `UPDATE finance_ledger_entries SET club_section_id=$1,finance_category_id=$2,kind=$3,amount_centavos=$4,currency=$5,finance_date=$6,
       status=COALESCE($7,status),decided_by_id=COALESCE($8,decided_by_id),decided_at=COALESCE($9,decided_at),rejection_reason=$10
       WHERE finance_ledger_entry_id=$11 RETURNING ${columns}`,
          [
            data.club_section_id ?? 7,
            data.finance_category_id ?? 11,
            data.kind ?? 'expense',
            data.amount_centavos ?? 1200,
            data.currency ?? 'MXN',
            data.finance_date ?? new Date('2026-07-31'),
            data.status,
            data.decided_by_id,
            data.decided_at,
            data.rejection_reason ?? null,
            finance_ledger_entry_id,
          ],
        ),
      ),
  };

  finance_ledger_events = {
    create: async ({ data }: any) => {
      if (this.failAt === 'event') throw new Error('event failure');
      return this.client.query(
        'INSERT INTO finance_ledger_events (finance_ledger_entry_id,event_type,actor_user_id,payload) VALUES ($1,$2,$3,$4::jsonb)',
        [
          data.finance_ledger_entry_id,
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
        'INSERT INTO audit_logs (entity_type,entity_id,action,club_id,actor_user_id,changes,event_key,correlation_id,idempotency_key) VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,$8,$9)',
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

const setup = async () => {
  if (!databaseUrl)
    throw new Error('explicit finance integration URL required');
  const schema = `finance_wu2c1_${randomBytes(6).toString('hex')}`;
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  await client.query(`SET TIME ZONE 'UTC'`);
  // prettier-ignore
  await client.query(`CREATE SCHEMA ${schema}; SET search_path=${schema},public; CREATE TABLE users (user_id UUID PRIMARY KEY); INSERT INTO users VALUES ('${actor}'); CREATE TABLE club_sections (club_section_id INT PRIMARY KEY, main_club_id INT); INSERT INTO club_sections VALUES (7,1),(8,1); CREATE TABLE finances (finance_id INT PRIMARY KEY); CREATE TABLE finances_categories (finance_category_id INT PRIMARY KEY, type INT NOT NULL, active BOOLEAN NOT NULL); INSERT INTO finances_categories VALUES (11,1,true); CREATE TABLE system_config (config_key TEXT PRIMARY KEY, config_value TEXT NOT NULL); INSERT INTO system_config VALUES ('finance.ledger_v2_writes_enabled','true'); CREATE TABLE audit_logs (entity_type TEXT,entity_id UUID,action TEXT,club_id INT,actor_user_id UUID,changes JSONB,event_key TEXT UNIQUE,correlation_id TEXT,idempotency_key TEXT);`);
  // prettier-ignore
  await client.query(readFileSync(join(process.cwd(), 'prisma/migrations/20260730200000_finance_ledger_v2_foundation/migration.sql'), 'utf8'));
  return { client, schema, db: new LedgerPrismaFixture(client) };
};

const close = async (client: Client, schema: string) => {
  await client.query('ROLLBACK').catch(() => undefined);
  await client.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
  await client.end();
};
// prettier-ignore
const service = (db: LedgerPrismaFixture, register = async () => undefined, decide = async () => undefined) => new FinanceLedgerService(db as any, { assertCanRegister: register }, { assertCanDecide: decide });
const counts = (client: Client) =>
  client.query(
    `SELECT (SELECT count(*)::int FROM finance_ledger_entries) entries,(SELECT count(*)::int FROM finance_ledger_events) events,(SELECT count(*)::int FROM audit_logs) audits,(SELECT count(*)::int FROM finance_idempotency_receipts) receipts`,
  );
const holdAuthorization = () => {
  let release!: () => void;
  let entered!: () => void;
  const waiting = new Promise<void>((resolve) => {
    release = resolve;
  });
  const enteredPromise = new Promise<void>((resolve) => {
    entered = resolve;
  });
  return {
    entered: enteredPromise,
    release,
    authorize: async () => {
      entered();
      await waiting;
    },
  };
};

describe('finance ledger service PostgreSQL safety', () => {
  dbIt(
    'serializes identical registration, reauthorizes replay, and rejects a mismatched payload',
    async () => {
      const first = await setup();
      const secondClient = new Client({ connectionString: databaseUrl });
      await secondClient.connect();
      await secondClient.query(`SET search_path=${first.schema},public`);
      try {
        const second = new LedgerPrismaFixture(secondClient);
        let authorizations = 0;
        const authorize = async () => {
          authorizations += 1;
        };
        const results = await Promise.all([
          service(first.db, authorize).registerEntry(input(), actor, key),
          service(second, authorize).registerEntry(input(), actor, key),
        ]);
        expect(results[0]).toEqual(results[1]);
        expect(authorizations).toBe(2);
        await expect(
          service(first.db, async () => {
            throw new Error('revoked');
          }).registerEntry(input(), actor, key),
        ).rejects.toThrow('revoked');
        await expect(
          service(first.db).registerEntry(
            input({ amountCentavos: 1201 }),
            actor,
            key,
          ),
        ).rejects.toMatchObject({ code: 'FINANCE_LEDGER_IDEMPOTENCY_REUSED' });
        await expect(counts(first.client)).resolves.toMatchObject({
          rows: [{ entries: 1, events: 1, audits: 1, receipts: 1 }],
        });
      } finally {
        await secondClient.end();
        await close(first.client, first.schema);
      }
    },
  );

  dbIt(
    'holds decision and amendment entry locks, locks source before target, and rejects no-op',
    async () => {
      const fixture = await setup();
      const writer = new Client({ connectionString: databaseUrl });
      await writer.connect();
      await writer.query(`SET search_path=${fixture.schema},public`);
      try {
        const registered = await service(fixture.db).registerEntry(
          input(),
          actor,
          key,
        );
        for (const [command, run] of [
          [
            'amendment',
            (hold: ReturnType<typeof holdAuthorization>) => {
              let calls = 0;
              return service(fixture.db, async () => {
                calls += 1;
                if (calls === 1) await hold.authorize();
              }).amendEntry(
                {
                  ...input({ clubSectionId: 8, amountCentavos: 1300 }),
                  entryId: registered.finance_ledger_entry_id,
                },
                actor,
                'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
              );
            },
          ],
          [
            'decision',
            (hold: ReturnType<typeof holdAuthorization>) =>
              service(
                fixture.db,
                async () => undefined,
                hold.authorize,
              ).decideEntry(
                {
                  entryId: registered.finance_ledger_entry_id,
                  decision: 'approve',
                },
                actor,
                'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
              ),
          ],
        ] as const) {
          const hold = holdAuthorization();
          const pending = run(hold);
          await hold.entered;
          await writer.query(`BEGIN; SET LOCAL lock_timeout='100ms'`);
          await expect(
            writer.query(
              'SELECT pg_advisory_xact_lock(hashtextextended($1,0))',
              [`finance-ledger-entry:${registered.finance_ledger_entry_id}`],
            ),
          ).rejects.toMatchObject({ code: '55P03' });
          await writer.query('ROLLBACK');
          hold.release();
          await pending;
          expect(command).toBeTruthy();
        }
        expect(fixture.db.sectionLocks.at(-1)).toEqual([7, 8]);
        const untouched = await service(fixture.db).registerEntry(
          input(),
          actor,
          'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
        );
        const beforeNoop = await counts(fixture.client);
        await expect(
          service(fixture.db).amendEntry(
            { ...input(), entryId: untouched.finance_ledger_entry_id },
            actor,
            'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
          ),
        ).rejects.toMatchObject({ code: 'FINANCE_LEDGER_NO_CHANGES' });
        await expect(counts(fixture.client)).resolves.toEqual(beforeNoop);
      } finally {
        await writer.end();
        await close(fixture.client, fixture.schema);
      }
    },
  );

  dbIt(
    'rolls back entry, event, audit, and receipt atomically when each durable write fails',
    async () => {
      for (const failAt of ['event', 'audit', 'receipt'] as const) {
        const fixture = await setup();
        try {
          fixture.db.failAt = failAt;
          await expect(
            service(fixture.db).registerEntry(input(), actor, key),
          ).rejects.toThrow(`${failAt} failure`);
          await expect(counts(fixture.client)).resolves.toMatchObject({
            rows: [{ entries: 0, events: 0, audits: 0, receipts: 0 }],
          });
        } finally {
          await close(fixture.client, fixture.schema);
        }
      }
    },
  );
});
