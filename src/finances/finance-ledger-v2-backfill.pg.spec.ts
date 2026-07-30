import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Client } from 'pg';

const root = join(__dirname, '..', '..');
const migration = readFileSync(
  join(
    root,
    'prisma/migrations/20260730200000_finance_ledger_v2_foundation/migration.sql',
  ),
  'utf8',
);
const backfillPath = join(
  root,
  'prisma/scripts/backfill-finance-ledger-v2.sql',
);
const backfill = existsSync(backfillPath)
  ? readFileSync(backfillPath, 'utf8')
  : 'BEGIN; COMMIT;';
const databaseUrl = process.env.AUTHORIZATION_P0_INTEGRATION_DATABASE_URL;
const dbIt =
  process.env.ALLOW_AUTHORIZATION_P0_INTEGRATION_DB === '1' && databaseUrl
    ? it
    : it.skip;

const prepare = async (client: Client, schema: string) => {
  await client.query(`CREATE SCHEMA ${schema}; SET search_path=${schema},public;
    CREATE TABLE users (user_id UUID PRIMARY KEY);
    CREATE TABLE club_sections (club_section_id INT PRIMARY KEY);
    CREATE TABLE finances_categories (finance_category_id INT PRIMARY KEY, type INT NOT NULL, active BOOLEAN NOT NULL);
    CREATE TABLE finances (finance_id INT PRIMARY KEY, active BOOLEAN NOT NULL, club_section_id INT, finance_category_id INT NOT NULL, amount INT NOT NULL, finance_date DATE NOT NULL, created_by UUID NOT NULL, created_at TIMESTAMPTZ, modified_at TIMESTAMPTZ);
    CREATE TABLE finance_evidence_files (finance_evidence_file_id INT PRIMARY KEY, finance_id INT NOT NULL, active BOOLEAN NOT NULL);
    CREATE TABLE system_config (config_key TEXT PRIMARY KEY, config_value TEXT NOT NULL, description TEXT NOT NULL, config_type TEXT NOT NULL);
    INSERT INTO users VALUES ('00000000-0000-0000-0000-000000000001');
    INSERT INTO club_sections VALUES (7);
    INSERT INTO finances_categories VALUES (11, 0, true), (12, 1, true);
    INSERT INTO system_config VALUES ('finance.ledger_v2_writes_enabled','false','flag','boolean');
    ${migration}`);
};

const openFixture = async () => {
  if (!databaseUrl) throw new Error('integration URL required');
  const schema = `finance_wu1b_${randomBytes(6).toString('hex')}`;
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  await prepare(client, schema);
  return { client, schema };
};

const closeFixture = async (client: Client, schema: string) => {
  await client.query('ROLLBACK');
  await client.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
  await client.end();
};

describe('finance ledger v2 legacy backfill', () => {
  dbIt(
    'backfills entries/events idempotently without monetizing evidence',
    async () => {
      const { client, schema } = await openFixture();
      try {
        await client.query(`INSERT INTO finances VALUES
        (101,true,7,11,20000,CURRENT_DATE,'00000000-0000-0000-0000-000000000001',now(),now()),
        (102,true,7,12,5000,CURRENT_DATE,'00000000-0000-0000-0000-000000000001',now(),now());
        INSERT INTO finance_evidence_files VALUES (501,101,true);
        ${backfill} ${backfill}`);
        await expect(
          client.query(`SELECT count(*)::int AS entries, sum(amount_centavos)::int AS total,
          (SELECT count(*)::int FROM finance_ledger_events) AS events,
          (SELECT count(*)::int FROM finance_vouchers) AS vouchers,
          (SELECT count(*)::int FROM finance_evidence_files) AS evidence
          FROM finance_ledger_entries`),
        ).resolves.toMatchObject({
          rows: [
            { entries: 2, total: 25000, events: 2, vouchers: 0, evidence: 1 },
          ],
        });
      } finally {
        await closeFixture(client, schema);
      }
    },
  );

  dbIt(
    'aborts invalid scope/category, drift and forced parity failures',
    async () => {
      const { client, schema } = await openFixture();
      try {
        await client.query(`INSERT INTO finances VALUES
        (101,true,NULL,11,20000,CURRENT_DATE,'00000000-0000-0000-0000-000000000001',now(),now())`);
        await expect(client.query(backfill)).rejects.toThrow(
          'without club_section_id',
        );
        await client.query('ROLLBACK');
        await client.query(
          'UPDATE finances SET club_section_id=7; UPDATE finances_categories SET active=false WHERE finance_category_id=11',
        );
        await expect(client.query(backfill)).rejects.toThrow(
          'invalid finance category',
        );
        await client.query('ROLLBACK');
        await client.query(`UPDATE finances_categories SET active=true;
        INSERT INTO finance_ledger_entries
          (legacy_finance_id,club_section_id,finance_category_id,kind,amount_centavos,currency,finance_date,status,registered_by_id,decided_at)
        VALUES (101,7,11,'income',1,'MXN',CURRENT_DATE,'approved','00000000-0000-0000-0000-000000000001',now())`);
        await expect(client.query(backfill)).rejects.toThrow(
          'drifted ledger entry',
        );
        await client.query('ROLLBACK');
        await client.query(`DELETE FROM finance_ledger_entries;
        CREATE FUNCTION distort_finance_amount() RETURNS trigger AS $$ BEGIN NEW.amount_centavos=NEW.amount_centavos+1; RETURN NEW; END $$ LANGUAGE plpgsql;
        CREATE TRIGGER distort_finance_amount BEFORE INSERT ON finance_ledger_entries FOR EACH ROW EXECUTE FUNCTION distort_finance_amount()`);
        await expect(client.query(backfill)).rejects.toThrow(
          'entry parity failed',
        );
        await client.query('ROLLBACK');
        await expect(
          client.query(
            'SELECT (SELECT count(*)::int FROM finance_ledger_entries) entries, (SELECT count(*)::int FROM finance_ledger_events) events',
          ),
        ).resolves.toMatchObject({ rows: [{ entries: 0, events: 0 }] });
      } finally {
        await closeFixture(client, schema);
      }
    },
  );

  dbIt(
    'rejects missing/null event lineage and rolls back new rows',
    async () => {
      for (const payload of ['{}', '{"legacy_finance_id":null}']) {
        const { client, schema } = await openFixture();
        try {
          await client.query(`INSERT INTO finances VALUES
          (101,true,7,11,100,CURRENT_DATE,'00000000-0000-0000-0000-000000000001',now(),now()),
          (102,true,7,11,200,CURRENT_DATE,'00000000-0000-0000-0000-000000000001',now(),now());
          INSERT INTO finance_evidence_files VALUES (501,102,true);
          INSERT INTO finance_ledger_entries
            (legacy_finance_id,club_section_id,finance_category_id,kind,amount_centavos,currency,finance_date,status,registered_by_id,decided_at)
          VALUES
            (101,7,11,'income',100,'MXN',CURRENT_DATE,'approved','00000000-0000-0000-0000-000000000001',now())`);
          await client.query(
            `INSERT INTO finance_ledger_events
              (finance_ledger_entry_id,event_type,actor_user_id,payload)
             SELECT finance_ledger_entry_id,'MIGRATED_LEGACY',
               '00000000-0000-0000-0000-000000000001',$1::jsonb
             FROM finance_ledger_entries`,
            [payload],
          );
          await expect(client.query(backfill)).rejects.toThrow(
            'event parity failed',
          );
          await client.query('ROLLBACK');
          await expect(
            client.query(`SELECT count(*)::int AS entries,
          (SELECT count(*)::int FROM finance_ledger_events) AS events,
          (SELECT count(*)::int FROM finance_vouchers) AS vouchers,
          (SELECT count(*)::int FROM finance_evidence_files) AS evidence
          FROM finance_ledger_entries`),
          ).resolves.toMatchObject({
            rows: [{ entries: 1, events: 1, vouchers: 0, evidence: 1 }],
          });
        } finally {
          await closeFixture(client, schema);
        }
      }
    },
  );
});
