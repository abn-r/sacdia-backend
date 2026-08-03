import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Client } from 'pg';
import { FinanceLedgerService } from './finance-ledger.service';

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
  readonly sectionLockQueries: string[] = [];
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
    this.sectionLockQueries.push(sql.text);
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
    update: async ({ where: { finance_ledger_entry_id }, data }: any) => {
      const columnsByField: Record<string, string> = {
        club_section_id: 'club_section_id',
        finance_category_id: 'finance_category_id',
        kind: 'kind',
        amount_centavos: 'amount_centavos',
        currency: 'currency',
        finance_date: 'finance_date',
        status: 'status',
        decided_by_id: 'decided_by_id',
        decided_at: 'decided_at',
        rejection_reason: 'rejection_reason',
      };
      const fields = Object.keys(data);
      return row(
        await this.client.query(
          `UPDATE finance_ledger_entries SET ${fields
            .map((field, index) => `${columnsByField[field]}=$${index + 1}`)
            .join(
              ',',
            )} WHERE finance_ledger_entry_id=$${fields.length + 1} RETURNING ${columns}`,
          [...fields.map((field) => data[field]), finance_ledger_entry_id],
        ),
      );
    },
  };

  finance_vouchers = {
    create: async ({ data }: any) => {
      try {
        return row(
          await this.client.query(
            `INSERT INTO finance_vouchers (ledger_entry_id,finance_ledger_evidence_id,amount_centavos,currency,source_uri,file_name,mime_type,file_size,recorded_by_id)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
           RETURNING finance_voucher_id,ledger_entry_id,finance_ledger_evidence_id,amount_centavos,currency`,
            [
              data.ledger_entry_id,
              data.finance_ledger_evidence_id,
              data.amount_centavos,
              data.currency,
              data.source_uri,
              data.file_name,
              data.mime_type,
              data.file_size,
              data.recorded_by_id,
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
      const target = data.finance_voucher_id
        ? 'finance_voucher_id'
        : 'finance_ledger_entry_id';
      return this.client.query(
        `INSERT INTO finance_ledger_events (${target},event_type,actor_user_id,payload) VALUES ($1,$2,$3,$4::jsonb)`,
        [
          data[target],
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

const configure = async (client: Client, schema?: string) => {
  await client.query("SET TIME ZONE 'UTC'");
  if (schema) await client.query(`SET search_path TO "${schema}"`);
};

const close = async (client: Client, schema?: string) => {
  await client.query('ROLLBACK').catch(() => undefined);
  if (schema)
    await client
      .query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`)
      .catch(() => undefined);
  await client.end().catch(() => undefined);
};

const setup = async () => {
  if (!databaseUrl)
    throw new Error('explicit finance integration URL required');
  const schema = `finance_wu2c2c_${randomBytes(6).toString('hex')}`;
  const client = new Client({ connectionString: databaseUrl });
  try {
    await client.connect();
    await configure(client);
    // prettier-ignore
    await client.query(`CREATE SCHEMA ${schema}; SET search_path TO "${schema}"; CREATE TABLE users (user_id UUID PRIMARY KEY); INSERT INTO users VALUES ('${actor}'); CREATE TABLE club_sections (club_section_id INT PRIMARY KEY, main_club_id INT); INSERT INTO club_sections VALUES (7,1),(8,1); CREATE TABLE finances (finance_id INT PRIMARY KEY); CREATE TABLE finances_categories (finance_category_id INT PRIMARY KEY, type INT NOT NULL, active BOOLEAN NOT NULL); INSERT INTO finances_categories VALUES (11,1,true); CREATE TABLE system_config (config_key TEXT PRIMARY KEY, config_value TEXT NOT NULL); INSERT INTO system_config VALUES ('finance.ledger_v2_writes_enabled','true'); CREATE TABLE audit_logs (entity_type TEXT,entity_id UUID,action TEXT,club_id INT,actor_user_id UUID,changes JSONB,event_key TEXT UNIQUE,correlation_id TEXT,idempotency_key TEXT);`);
    // prettier-ignore
    await client.query(readFileSync(join(process.cwd(), 'prisma/migrations/20260730200000_finance_ledger_v2_foundation/migration.sql'), 'utf8'));
    await client.query(
      readFileSync(
        join(
          process.cwd(),
          'prisma/migrations/20260803184000_finance_voucher_integrity/migration.sql',
        ),
        'utf8',
      ),
    );
    return { client, schema, db: new LedgerPrismaFixture(client) };
  } catch (error) {
    await close(client, schema);
    throw error;
  }
};
// prettier-ignore
const service = (db: LedgerPrismaFixture, register = async () => undefined, decide = async () => undefined) => new FinanceLedgerService(db as any, { assertCanRegister: register }, { assertCanDecide: decide });
const counts = (client: Client) =>
  client.query(
    `SELECT (SELECT count(*)::int FROM finance_ledger_entries) entries,(SELECT count(*)::int FROM finance_ledger_events) events,(SELECT count(*)::int FROM audit_logs) audits,(SELECT count(*)::int FROM finance_idempotency_receipts) receipts`,
  );

const voucherCounts = (client: Client) =>
  client.query(
    `SELECT (SELECT count(*)::int FROM finance_vouchers) vouchers,
      (SELECT count(*)::int FROM finance_ledger_events) events,
      (SELECT count(*)::int FROM audit_logs) audits,
      (SELECT count(*)::int FROM finance_idempotency_receipts) receipts`,
  );

const setupAttachment = async () => {
  const fixture = await setup();
  const entry = row(
    await fixture.client.query(
      `INSERT INTO finance_ledger_entries (club_section_id,finance_category_id,kind,amount_centavos,currency,finance_date,status,registered_by_id,decided_by_id,decided_at)
       VALUES (7,11,'expense',1200,'MXN','2026-08-03','approved',$1,$1,CURRENT_TIMESTAMP)
       RETURNING finance_ledger_entry_id`,
      [actor],
    ),
  );
  const evidence = row(
    await fixture.client.query(
      `INSERT INTO finance_ledger_evidence (club_section_id,storage_key,mime_type,file_size,content_sha256,created_by_id)
       VALUES (7,'finance-ledger/owned-receipt.pdf','application/pdf',512,repeat('a',64),$1)
       RETURNING finance_ledger_evidence_id`,
      [actor],
    ),
  );
  return {
    ...fixture,
    entryId: entry.finance_ledger_entry_id,
    evidenceId: evidence.finance_ledger_evidence_id,
  };
};

const voucherService = (
  db: LedgerPrismaFixture,
  evidenceId: string,
  authorize = async () => undefined,
) =>
  new FinanceLedgerService(
    db as any,
    { assertCanRegister: authorize },
    { assertCanDecide: async () => undefined },
    {
      resolveOwnedEvidence: async ({ opaqueEvidenceHandle }: any) => {
        if (opaqueEvidenceHandle !== 'owned-evidence')
          throw new Error('unknown opaque evidence');
        return { financeLedgerEvidenceId: evidenceId };
      },
    },
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
  it('fails closed before connecting when an opted-in URL is invalid', () => {
    for (const value of [
      undefined,
      'not-a-url',
      'postgresql://abner@localhost/postgres?finance_ledger_scratch=0',
      'postgresql://abner@localhost/postgres?host=evil.example&finance_ledger_scratch=1',
    ])
      expect(() => resolveFinanceDatabaseUrl(value, true)).toThrow();
    expect(resolveFinanceDatabaseUrl(undefined, false)).toBeUndefined();
  });

  it('accepts only the explicit socket or normalized IPv6 loopback', () => {
    expect(
      resolveFinanceDatabaseUrl(
        'postgresql://abner@[::1]/postgres?finance_ledger_scratch=1',
        true,
      ),
    ).toContain('[::1]');
    expect(normalizeDatabaseHost('[::1]')).toBe('::1');
    expect(
      resolveFinanceDatabaseUrl(
        'postgresql://abner@localhost/postgres?host=%2Ftmp&finance_ledger_scratch=1',
        true,
      ),
    ).toContain('host=%2Ftmp');
  });

  dbIt(
    'serializes identical registration, reauthorizes replay, and rejects a mismatched payload',
    async () => {
      const first = await setup();
      let secondClient: Client | undefined;
      try {
        secondClient = new Client({ connectionString: databaseUrl });
        try {
          await secondClient.connect();
          await configure(secondClient, first.schema);
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
          ).rejects.toMatchObject({
            code: 'FINANCE_LEDGER_IDEMPOTENCY_REUSED',
          });
          await expect(counts(first.client)).resolves.toMatchObject({
            rows: [{ entries: 1, events: 1, audits: 1, receipts: 1 }],
          });
        } finally {
          if (secondClient) await close(secondClient);
        }
      } finally {
        await close(first.client, first.schema);
      }
    },
  );

  dbIt(
    'holds decision and amendment entry locks, locks source before target, and rejects no-op',
    async () => {
      const fixture = await setup();
      let writer: Client | undefined;
      try {
        writer = new Client({ connectionString: databaseUrl });
        try {
          await writer.connect();
          await configure(writer, fixture.schema);
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
            const result = await pending;
            if (command === 'decision')
              expect(result).toMatchObject({
                club_section_id: 8,
                amount_centavos: 1300,
              });
            expect(command).toBeTruthy();
          }
          expect(fixture.db.sectionLocks.at(-1)).toEqual([7, 8]);
          expect(fixture.db.sectionLockQueries.at(-1)).toMatch(
            /ORDER BY "club_section_id" FOR UPDATE/,
          );
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
          if (writer) await close(writer);
        }
      } finally {
        await close(fixture.client, fixture.schema);
      }
    },
  );

  dbIt(
    'rolls back every durable write for registration, decision, and amendment',
    async () => {
      for (const operation of [
        'registration',
        'decision',
        'amendment',
      ] as const) {
        for (const failAt of ['event', 'audit', 'receipt'] as const) {
          const fixture = await setup();
          try {
            let before = await counts(fixture.client);
            let pending: Promise<unknown>;
            if (operation === 'registration') {
              pending = service(fixture.db).registerEntry(input(), actor, key);
            } else {
              const entry = await service(fixture.db).registerEntry(
                input(),
                actor,
                operation === 'decision'
                  ? 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
                  : 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
              );
              before = await counts(fixture.client);
              pending =
                operation === 'decision'
                  ? service(fixture.db).decideEntry(
                      {
                        entryId: entry.finance_ledger_entry_id,
                        decision: 'approve',
                      },
                      actor,
                      key,
                    )
                  : service(fixture.db).amendEntry(
                      {
                        ...input({ amountCentavos: 1201 }),
                        entryId: entry.finance_ledger_entry_id,
                      },
                      actor,
                      key,
                    );
            }
            fixture.db.failAt = failAt;
            await expect(pending).rejects.toThrow(`${failAt} failure`);
            await expect(counts(fixture.client)).resolves.toEqual(before);
            if (operation !== 'registration')
              await expect(
                fixture.client.query(
                  'SELECT status,amount_centavos FROM finance_ledger_entries',
                ),
              ).resolves.toMatchObject({
                rows: [{ status: 'pending_approval', amount_centavos: 1200 }],
              });
          } finally {
            await close(fixture.client, fixture.schema);
          }
        }
      }
    },
  );

  dbIt(
    'attaches one owned voucher under concurrent keys and reauthorizes a durable replay',
    async () => {
      const fixture = await setupAttachment();
      let secondClient: Client | undefined;
      try {
        secondClient = new Client({ connectionString: databaseUrl });
        await secondClient.connect();
        await configure(secondClient, fixture.schema);
        const second = new LedgerPrismaFixture(secondClient);
        let authorizations = 0;
        const authorize = async () => {
          authorizations += 1;
        };
        const request = (opaqueEvidenceHandle = 'owned-evidence') => ({
          clubId: 1,
          clubSectionId: 7,
          entryId: fixture.entryId,
          opaqueEvidenceHandle,
        });
        const firstKey = '11111111-1111-4111-8111-111111111111';
        const secondKey = '22222222-2222-4222-8222-222222222222';
        const attempts = await Promise.allSettled([
          voucherService(
            fixture.db,
            fixture.evidenceId,
            authorize,
          ).attachVoucher(request(), actor, firstKey),
          voucherService(second, fixture.evidenceId, authorize).attachVoucher(
            request(),
            actor,
            secondKey,
          ),
        ]);
        const success = attempts.find(
          (attempt): attempt is PromiseFulfilledResult<Record<string, any>> =>
            attempt.status === 'fulfilled',
        );
        const conflict = attempts.find(
          (attempt): attempt is PromiseRejectedResult =>
            attempt.status === 'rejected',
        );
        expect(success).toBeDefined();
        expect(conflict?.reason).toMatchObject({
          code: 'FINANCE_LEDGER_STATUS_INVALID',
        });
        expect(conflict?.reason.getResponse()).toEqual({
          code: 'FINANCE_LEDGER_STATUS_INVALID',
          statusCode: 409,
        });
        expect(authorizations).toBe(2);
        await expect(voucherCounts(fixture.client)).resolves.toMatchObject({
          rows: [{ vouchers: 1, events: 1, audits: 1, receipts: 1 }],
        });

        const replayKey =
          attempts[0].status === 'fulfilled' ? firstKey : secondKey;
        await expect(
          voucherService(
            fixture.db,
            fixture.evidenceId,
            authorize,
          ).attachVoucher(request(), actor, replayKey),
        ).resolves.toEqual(success?.value);
        expect(authorizations).toBe(3);
        await expect(voucherCounts(fixture.client)).resolves.toMatchObject({
          rows: [{ vouchers: 1, events: 1, audits: 1, receipts: 1 }],
        });
      } finally {
        if (secondClient) await close(secondClient);
        await close(fixture.client, fixture.schema);
      }
    },
  );

  dbIt(
    'rolls back attachment failures and keeps database integrity constraints active',
    async () => {
      const fixture = await setupAttachment();
      try {
        const attach = (key: string) =>
          voucherService(fixture.db, fixture.evidenceId).attachVoucher(
            {
              clubId: 1,
              clubSectionId: 7,
              entryId: fixture.entryId,
              opaqueEvidenceHandle: 'owned-evidence',
            },
            actor,
            key,
          );
        for (const [failAt, key] of [
          ['event', '33333333-3333-4333-8333-333333333333'],
          ['audit', '44444444-4444-4444-8444-444444444444'],
          ['receipt', '55555555-5555-4555-8555-555555555555'],
        ] as const) {
          const before = await voucherCounts(fixture.client);
          fixture.db.failAt = failAt;
          await expect(attach(key)).rejects.toThrow(`${failAt} failure`);
          expect(await voucherCounts(fixture.client)).toEqual(before);
        }
        fixture.db.failAt = undefined;
        const voucher = await attach('66666666-6666-4666-8666-666666666666');
        await expect(
          fixture.client.query(
            `INSERT INTO finance_ledger_evidence (club_section_id,storage_key,mime_type,file_size,content_sha256,created_by_id)
             VALUES (7,'finance-ledger/owned-receipt.pdf','application/pdf',512,repeat('b',64),$1)`,
            [actor],
          ),
        ).rejects.toMatchObject({ code: '23505' });
        await expect(
          fixture.client.query(
            `INSERT INTO finance_ledger_evidence (club_section_id,storage_key,mime_type,file_size,content_sha256,created_by_id)
             VALUES (7,'finance-ledger/duplicate.pdf','application/pdf',512,repeat('a',64),$1)`,
            [actor],
          ),
        ).rejects.toMatchObject({ code: '23505' });
        await expect(
          fixture.client.query(
            `INSERT INTO finance_vouchers (ledger_entry_id,amount_centavos,currency,source_uri,file_name,mime_type,recorded_by_id)
             VALUES ($1,1201,'MXN','finance-ledger/mismatch.pdf','mismatch.pdf','application/pdf',$2)`,
            [fixture.entryId, actor],
          ),
        ).rejects.toMatchObject({ code: '23514' });
        await expect(
          fixture.client.query(
            `INSERT INTO finance_ledger_events (finance_ledger_entry_id,finance_voucher_id,event_type,actor_user_id,payload)
             VALUES ($1,$2,'VOUCHER_ATTACHED',$3,'{}')`,
            [fixture.entryId, voucher.finance_voucher_id, actor],
          ),
        ).rejects.toMatchObject({ code: '23514' });
      } finally {
        await close(fixture.client, fixture.schema);
      }
    },
  );
});
