import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Client } from 'pg';

const migration = readFileSync(
  join(
    __dirname,
    '..',
    '..',
    'prisma/migrations/20260730200000_finance_ledger_v2_foundation/migration.sql',
  ),
  'utf8',
);
const databaseUrl = process.env.AUTHORIZATION_P0_INTEGRATION_DATABASE_URL;
const dbIt =
  process.env.ALLOW_AUTHORIZATION_P0_INTEGRATION_DB === '1' && databaseUrl
    ? it
    : it.skip;

const createLegacySchema = (client: Client, schema: string) =>
  client.query(`CREATE SCHEMA ${schema}; SET search_path=${schema},public;
    CREATE TABLE users (user_id UUID PRIMARY KEY);
    CREATE TABLE club_sections (club_section_id INT PRIMARY KEY);
    CREATE TABLE finances_categories (finance_category_id INT PRIMARY KEY, type INT NOT NULL);
    CREATE TABLE finances (finance_id INT PRIMARY KEY);
    INSERT INTO users VALUES
      ('00000000-0000-0000-0000-000000000001'),
      ('00000000-0000-0000-0000-000000000002');
    INSERT INTO club_sections VALUES (7);
    INSERT INTO finances_categories VALUES (11, 0);
    INSERT INTO finances VALUES (101);`);

describe('finance ledger v2 foundation migration', () => {
  dbIt('rolls back every schema object when migration fails', async () => {
    if (!databaseUrl) throw new Error('integration URL required');
    const schema = `finance_wu1_rollback_${randomBytes(6).toString('hex')}`;
    const client = new Client({ connectionString: databaseUrl });
    await client.connect();
    try {
      await createLegacySchema(client, schema);
      await expect(
        client.query(
          `SET search_path=${schema},public; ${migration.replace('COMMIT;', 'SELECT 1 / 0; COMMIT;')}`,
        ),
      ).rejects.toMatchObject({ code: '22012' });
      await client.query('ROLLBACK');
      await expect(
        client.query(
          `SELECT to_regclass('finance_ledger_entries') AS relation,
             EXISTS (SELECT 1 FROM pg_type WHERE typnamespace = current_schema()::regnamespace AND typname = 'finance_ledger_entry_kind') AS has_type`,
        ),
      ).resolves.toMatchObject({
        rows: [{ relation: null, has_type: false }],
      });
    } finally {
      await client.query('ROLLBACK');
      await client.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
      await client.end();
    }
  });

  dbIt('enforces currencies, decisions and append-only events', async () => {
    if (!databaseUrl) throw new Error('integration URL required');
    const schema = `finance_wu1_invariants_${randomBytes(6).toString('hex')}`;
    const client = new Client({ connectionString: databaseUrl });
    await client.connect();
    try {
      await createLegacySchema(client, schema);
      await client.query(`SET search_path=${schema},public; ${migration}`);
      const entry = await client.query<{ finance_ledger_entry_id: string }>(
        `INSERT INTO finance_ledger_entries
          (club_section_id, finance_category_id, kind, amount_centavos, currency, finance_date, registered_by_id)
         VALUES (7, 11, 'income', 10000, 'MXN', CURRENT_DATE, '00000000-0000-0000-0000-000000000001')
         RETURNING finance_ledger_entry_id`,
      );
      await expect(
        client.query(
          `INSERT INTO finance_ledger_entries
            (club_section_id, finance_category_id, kind, amount_centavos, currency, finance_date, registered_by_id)
           VALUES (7, 11, 'income', 100, 'ZZZ', CURRENT_DATE, '00000000-0000-0000-0000-000000000001')`,
        ),
      ).rejects.toMatchObject({ code: '23503' });
      for (const [status, reason] of [
        ['approved', null],
        ['rejected', 'invalid'],
      ] as const) {
        await expect(
          client.query(
            `INSERT INTO finance_ledger_entries
              (club_section_id, finance_category_id, kind, amount_centavos, currency, finance_date, status, registered_by_id, decided_at, rejection_reason)
             VALUES (7, 11, 'expense', 100, 'MXN', CURRENT_DATE, $1,
               '00000000-0000-0000-0000-000000000001', now(), $2)`,
            [status, reason],
          ),
        ).rejects.toMatchObject({
          code: '23514',
          constraint: 'finance_ledger_entries_lifecycle_check',
        });
      }
      await expect(
        client.query(
          `INSERT INTO finance_vouchers
            (ledger_entry_id, amount_centavos, currency, source_uri, file_name, mime_type, recorded_by_id)
           VALUES ($1, 10000, 'ZZZ', 'r2://voucher', 'receipt.pdf', 'application/pdf',
             '00000000-0000-0000-0000-000000000001')`,
          [entry.rows[0].finance_ledger_entry_id],
        ),
      ).rejects.toMatchObject({ code: '23503' });
      const event = await client.query<{ finance_ledger_event_id: string }>(
        `INSERT INTO finance_ledger_events
          (finance_ledger_entry_id, event_type, actor_user_id, payload)
         VALUES ($1, 'CREATED', '00000000-0000-0000-0000-000000000001', '{}')
         RETURNING finance_ledger_event_id`,
        [entry.rows[0].finance_ledger_entry_id],
      );
      await expect(
        client.query(
          'UPDATE finance_ledger_events SET payload = \'{"tampered":true}\' WHERE finance_ledger_event_id = $1',
          [event.rows[0].finance_ledger_event_id],
        ),
      ).rejects.toMatchObject({ code: '23000' });
      await expect(
        client.query(
          'DELETE FROM finance_ledger_events WHERE finance_ledger_event_id = $1',
          [event.rows[0].finance_ledger_event_id],
        ),
      ).rejects.toMatchObject({ code: '23000' });
    } finally {
      await client.query('ROLLBACK');
      await client.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
      await client.end();
    }
  });
});
