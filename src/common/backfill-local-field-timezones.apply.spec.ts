import { randomBytes } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import {
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client } from 'pg';
import {
  applyLocalFieldTimezoneBackfill,
  planLocalFieldTimezoneBackfill,
} from '../../scripts/backfill-local-field-timezones';
import { loadCanonicalGeographicIanaTimezoneCatalog } from './timezone/canonical-geographic-iana-timezone';

const databaseUrl = process.env.AUTHORIZATION_P0_INTEGRATION_DATABASE_URL;
const dbIt =
  process.env.ALLOW_AUTHORIZATION_P0_INTEGRATION_DB === '1' && databaseUrl
    ? it
    : it.skip;
const catalog = loadCanonicalGeographicIanaTimezoneCatalog();
const mapping = new Map([
  [1, 'America/Tijuana'],
  [2, 'America/Cancun'],
]);
const correlationId = '00000000-0000-0000-0000-000000000099';
const applyMapping = (client: Client, values: ReadonlyMap<number, string>) =>
  applyLocalFieldTimezoneBackfill(client, values, catalog, correlationId);
const applyBackfill = (client: Client) => applyMapping(client, mapping);

async function fixture(client: Client, schema: string, badAudit = false) {
  await client.query(`CREATE SCHEMA ${schema}; SET search_path=${schema},public;
    CREATE TABLE local_fields (local_field_id int PRIMARY KEY, name text, union_id int, active boolean, timezone text, modified_at timestamptz);
    CREATE TABLE classes (class_id int PRIMARY KEY, asset_code text);
    CREATE TABLE authorization_context_versions (user_id uuid PRIMARY KEY, version bigint NOT NULL, modified_at timestamptz);
    CREATE TABLE clubs (club_id int PRIMARY KEY, local_field_id int);
    CREATE TABLE club_sections (club_section_id int PRIMARY KEY, main_club_id int);
    CREATE TABLE club_role_assignments (assignment_id uuid, user_id uuid, role_id uuid, ecclesiastical_year_id int, start_date date, end_date date, active boolean, status text, expires_at timestamptz, club_section_id int);
    CREATE TABLE roles (role_id uuid, role_name text, role_category text);
    CREATE TABLE ecclesiastical_years (year_id int, start_date date, end_date date);
    CREATE TABLE users_pr (user_id uuid, active_club_assignment_id uuid);
    CREATE TABLE audit_logs (audit_log_id bigserial, entity_type text, entity_id text, action text, event_key text UNIQUE, actor_kind text, actor_scope jsonb, target_scope jsonb, changes jsonb, effective_at timestamptz, correlation_id uuid, idempotency_key text, result text);
    CREATE TABLE director_succession_plans (club_section_id int, status text, scheduled_local_field_id int, version int, processing_token uuid, processing_expires_at timestamptz, modified_at timestamptz);
    INSERT INTO local_fields VALUES (1,'Norte',1,true,NULL,'2025-01-01'),(2,'Sur',1,true,'America/Cancun','2025-01-01');
    INSERT INTO classes VALUES (1,'GM-01'); INSERT INTO clubs VALUES (1,1),(2,2);
    INSERT INTO club_sections VALUES (1,1),(2,2);
    INSERT INTO roles VALUES ('00000000-0000-0000-0000-000000000001','Director','CLUB');
    INSERT INTO ecclesiastical_years VALUES (1,'2026-01-01','2026-12-31');
    INSERT INTO club_role_assignments VALUES
      ('00000000-0000-0000-0000-000000000011','00000000-0000-0000-0000-000000000010','00000000-0000-0000-0000-000000000001',1,'2026-01-01','2026-12-31',true,'active',NULL,1),
      ('00000000-0000-0000-0000-000000000012','00000000-0000-0000-0000-000000000020','00000000-0000-0000-0000-000000000001',1,'2026-01-01','2026-12-31',true,'active',NULL,2);
    INSERT INTO authorization_context_versions VALUES
      ('00000000-0000-0000-0000-000000000010',7,NOW()),
      ('00000000-0000-0000-0000-000000000020',9,NOW());
    INSERT INTO director_succession_plans VALUES
      (1,'scheduled',1,4,'00000000-0000-0000-0000-000000000031',NOW() + interval '1 hour','2025-01-01'),
      (1,'activated',1,6,'00000000-0000-0000-0000-000000000032',NOW() + interval '1 hour','2025-01-01'),
      (2,'scheduled',2,8,'00000000-0000-0000-0000-000000000033',NOW() + interval '1 hour','2025-01-01');`);
  if (badAudit)
    await client.query(
      `INSERT INTO audit_logs (action) VALUES (repeat('x',65))`,
    );
}

async function withFixture(
  body: (client: Client, schema: string) => Promise<void>,
  badAudit = false,
) {
  if (!databaseUrl) throw new Error('integration URL required');
  const schema = `be04a2_${randomBytes(6).toString('hex')}`;
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    await fixture(client, schema, badAudit);
    await body(client, schema);
  } finally {
    await client.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    await client.end();
  }
}

async function expectOriginalState(client: Client) {
  const state = await client.query(
    `SELECT (SELECT timezone FROM local_fields WHERE local_field_id=1),
      (SELECT version FROM authorization_context_versions
        WHERE user_id='00000000-0000-0000-0000-000000000010'),
      version plan_version, processing_token FROM director_succession_plans
      WHERE status='scheduled' AND scheduled_local_field_id=1`,
  );
  expect(state.rows[0]).toMatchObject({
    timezone: null,
    version: '7',
    plan_version: 4,
    processing_token: '00000000-0000-0000-0000-000000000031',
  });
}

function runCli(schema: string, values: Record<string, string>) {
  const directory = mkdtempSync(join(tmpdir(), 'sacdia-be04a3-'));
  const mappingPath = join(directory, 'mapping.json');
  const connection = new URL(databaseUrl!);
  connection.searchParams.set('options', `-csearch_path=${schema},public`);
  writeFileSync(mappingPath, JSON.stringify(values));
  try {
    const result = spawnSync(
      join(process.cwd(), 'node_modules/.bin/tsx'),
      [
        join(process.cwd(), 'scripts/backfill-local-field-timezones.ts'),
        '--mapping',
        mappingPath,
        '--apply',
      ],
      {
        encoding: 'utf8',
        env: {
          ...process.env,
          AUTHORIZATION_P0_BACKFILL_DATABASE_URL: connection.toString(),
        },
      },
    );
    return {
      exitCode: result.status,
      report: JSON.parse(result.stdout.trim()) as Record<string, unknown>,
    };
  } finally {
    rmSync(directory, { recursive: true });
  }
}

function runCliAsync(schema: string, values: Record<string, string>) {
  const directory = mkdtempSync(join(tmpdir(), 'sacdia-be04a3-race-'));
  const mappingPath = join(directory, 'mapping.json');
  const connection = new URL(databaseUrl!);
  connection.searchParams.set('options', `-csearch_path=${schema},public`);
  writeFileSync(mappingPath, JSON.stringify(values));
  const child = spawn(
    join(process.cwd(), 'node_modules/.bin/tsx'),
    [
      join(process.cwd(), 'scripts/backfill-local-field-timezones.ts'),
      '--mapping',
      mappingPath,
      '--apply',
    ],
    {
      env: {
        ...process.env,
        AUTHORIZATION_P0_BACKFILL_DATABASE_URL: connection.toString(),
      },
    },
  );
  let stdout = '';
  child.stdout.setEncoding('utf8').on('data', (chunk) => (stdout += chunk));
  return new Promise<{
    exitCode: number | null;
    report: Record<string, unknown>;
  }>((resolve, reject) => {
    child.on('error', reject);
    child.on('close', (exitCode) => {
      rmSync(directory, { recursive: true });
      resolve({
        exitCode,
        report: JSON.parse(stdout.trim()) as Record<string, unknown>,
      });
    });
  });
}

describe('local field timezone backfill apply primitive', () => {
  it('locks the sole GM-01 row with FOR UPDATE during apply planning', () => {
    const source = readFileSync(
      join(__dirname, '../../scripts/backfill-local-field-timezones.ts'),
      'utf8',
    );
    const applyPlan = source.slice(
      source.indexOf('async function inspectApplyPlan'),
      source.indexOf('export async function planLocalFieldTimezoneBackfill'),
    );
    expect(applyPlan).toMatch(
      /SELECT class_id FROM classes WHERE asset_code = 'GM-01'\s+FOR UPDATE/s,
    );
  });

  dbIt('wires validated apply and reports replay and preflight outcomes', () =>
    withFixture(async (client, schema) => {
      const incomplete = runCli(schema, { '1': 'America/Tijuana' });
      expect(incomplete).toMatchObject({
        exitCode: 1,
        report: {
          status: 'error',
          error: { diagnostic: 'BACKFILL_MAPPING_INCOMPLETE' },
        },
      });
      await expectOriginalState(client);

      const first = runCli(schema, {
        '1': 'America/Tijuana',
        '2': 'America/Cancun',
      });
      expect(first).toMatchObject({
        exitCode: 0,
        report: { status: 'applied', dry_run: false, changed_field_count: 1 },
      });
      const replay = runCli(schema, {
        '1': 'America/Tijuana',
        '2': 'America/Cancun',
      });
      expect(replay).toMatchObject({
        exitCode: 0,
        report: { status: 'applied', dry_run: false, changed_field_count: 0 },
      });
      await expect(
        client.query(`SELECT count(*)::int count FROM audit_logs`),
      ).resolves.toMatchObject({ rows: [{ count: 1 }] });

      await client.query(
        `INSERT INTO audit_logs (action) VALUES (repeat('x',65))`,
      );
      const blocked = runCli(schema, {
        '1': 'America/Tijuana',
        '2': 'America/Cancun',
      });
      expect(blocked).toMatchObject({
        exitCode: 1,
        report: {
          status: 'error',
          error: { diagnostic: 'BACKFILL_POST_PREFLIGHT_BLOCKED' },
        },
      });
    }),
  );

  dbIt('audits atomic effects and remains replay safe', () =>
    withFixture(async (client) => {
      await applyBackfill(client);
      await expect(
        client.query(`SELECT timezone, modified_at > '2025-01-01' changed
          FROM local_fields WHERE local_field_id=1`),
      ).resolves.toMatchObject({
        rows: [{ timezone: 'America/Tijuana', changed: true }],
      });
      const versions = await client.query(
        `SELECT user_id, version FROM authorization_context_versions ORDER BY user_id`,
      );
      expect(versions.rows).toEqual([
        { user_id: '00000000-0000-0000-0000-000000000010', version: '8' },
        { user_id: '00000000-0000-0000-0000-000000000020', version: '9' },
      ]);
      const plans = await client.query(`SELECT status, scheduled_local_field_id,
        version, processing_token, processing_expires_at,
        modified_at > '2025-01-01' changed FROM director_succession_plans
        ORDER BY scheduled_local_field_id, status`);
      expect(plans.rows).toMatchObject([
        {
          status: 'activated',
          scheduled_local_field_id: 1,
          version: 6,
          processing_token: '00000000-0000-0000-0000-000000000032',
        },
        {
          status: 'scheduled',
          scheduled_local_field_id: 1,
          version: 5,
          processing_token: null,
          processing_expires_at: null,
          changed: true,
        },
        {
          status: 'scheduled',
          scheduled_local_field_id: 2,
          version: 8,
          processing_token: '00000000-0000-0000-0000-000000000033',
        },
      ]);
      await expect(
        client.query(`SELECT action, actor_kind, target_scope, changes,
          correlation_id, idempotency_key, result FROM audit_logs`),
      ).resolves.toMatchObject({
        rows: [
          {
            action: 'LOCAL_FIELD_TIMEZONE_UPDATED',
            actor_kind: 'system',
            target_scope: { local_field_id: 1 },
            changes: {
              before: { timezone: null },
              after: { timezone: 'America/Tijuana' },
            },
            correlation_id: correlationId,
            idempotency_key: correlationId,
            result: 'succeeded',
          },
        ],
      });
      await expect(
        planLocalFieldTimezoneBackfill(client, mapping),
      ).resolves.toMatchObject({
        fields: [{ operation: 'unchanged' }, { operation: 'unchanged' }],
      });
      await applyBackfill(client);
      await expect(
        client.query(`SELECT count(*)::int count FROM audit_logs`),
      ).resolves.toMatchObject({ rows: [{ count: 1 }] });
      const incompatible = new Map(mapping).set(1, 'America/Mazatlan');
      await expect(applyMapping(client, incompatible)).rejects.toMatchObject({
        code: '23505',
      });
      const conflictState = await client.query(
        `SELECT (SELECT timezone FROM local_fields WHERE local_field_id=1),
          (SELECT count(*)::int FROM audit_logs) audit_count,
          changes->'after'->>'timezone' audited_timezone FROM audit_logs`,
      );
      expect(conflictState.rows[0]).toMatchObject({
        timezone: 'America/Tijuana',
        audit_count: 1,
        audited_timezone: 'America/Tijuana',
      });
    }),
  );

  dbIt('rolls back post-preflight and intermediate audit failures', () =>
    withFixture(async (client) => {
      await client.query(`ALTER TABLE audit_logs ADD CONSTRAINT reject_event
        CHECK (action <> 'LOCAL_FIELD_TIMEZONE_UPDATED')`);
      await expect(applyBackfill(client)).rejects.toMatchObject({
        code: '23514',
      });
      await expectOriginalState(client);
      await client.query(`ALTER TABLE audit_logs DROP CONSTRAINT reject_event;
        INSERT INTO audit_logs (action) VALUES (repeat('x',65))`);
      await expect(applyBackfill(client)).rejects.toMatchObject({
        code: 'BACKFILL_POST_PREFLIGHT_BLOCKED',
      });
      await expectOriginalState(client);
    }),
  );

  dbIt('fails with a stable diagnostic instead of waiting indefinitely', () =>
    withFixture(async (locker, schema) => {
      try {
        await locker.query(`BEGIN; SELECT 1 FROM local_fields
          WHERE local_field_id=1 FOR UPDATE`);
        expect(
          runCli(schema, {
            '1': 'America/Tijuana',
            '2': 'America/Cancun',
          }),
        ).toMatchObject({
          exitCode: 1,
          report: {
            status: 'error',
            error: { diagnostic: 'BACKFILL_LOCK_TIMEOUT' },
          },
        });
        await expectOriginalState(locker);
      } finally {
        await locker.query('ROLLBACK');
      }
    }),
  );

  dbIt('maps a concurrent serialization loser and converges on replay', () =>
    withFixture(async (client, schema) => {
      const values = {
        '1': 'America/Tijuana',
        '2': 'America/Cancun',
      };
      const results = await Promise.all([
        runCliAsync(schema, values),
        runCliAsync(schema, values),
      ]);
      expect(results).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            exitCode: 0,
            report: expect.objectContaining({ status: 'applied' }),
          }),
          expect.objectContaining({
            exitCode: 1,
            report: {
              status: 'error',
              error: {
                diagnostic: 'BACKFILL_SERIALIZATION_CONFLICT',
                details: {},
              },
            },
          }),
        ]),
      );
      const state = await client.query(`SELECT
        (SELECT timezone FROM local_fields WHERE local_field_id=1),
        (SELECT version FROM authorization_context_versions
          WHERE user_id='00000000-0000-0000-0000-000000000010'),
        (SELECT count(*)::int FROM audit_logs) audit_count`);
      expect(state.rows[0]).toMatchObject({
        timezone: 'America/Tijuana',
        version: '8',
        audit_count: 1,
      });
      expect(runCli(schema, values)).toMatchObject({
        exitCode: 0,
        report: { status: 'applied', changed_field_count: 0 },
      });
    }),
  );
});
