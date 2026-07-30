import { randomBytes } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { Client } from 'pg';
import {
  classifyOperationalFailure,
  CONSUMER_INVENTORY,
  finalizeChecks,
} from '../../scripts/verify-authorization-director-succession-p0';
import {
  PINNED_IANA_METADATA,
  type CanonicalGeographicIanaTimezoneCatalog,
} from './timezone/canonical-geographic-iana-timezone';
import { createTestConsumerRoots } from './testing/authorization-p0-consumer-roots.fixture';

type Json = Record<string, unknown>;
const root = join(__dirname, '../..');
const consumerRoots = createTestConsumerRoots(CONSUMER_INVENTORY);
afterAll(() => consumerRoots.dispose());
const databaseUrl = process.env.AUTHORIZATION_P0_INTEGRATION_DATABASE_URL;
const dbIt =
  process.env.ALLOW_AUTHORIZATION_P0_INTEGRATION_DB === '1' && databaseUrl
    ? it
    : it.skip;
function runCli(url?: string, extraEnv: NodeJS.ProcessEnv = {}) {
  const result = spawnSync('pnpm', ['--silent', 'verify:authorization-p0'], {
    cwd: root,
    encoding: 'utf8',
    timeout: 10_000,
    env: {
      ...process.env,
      SACDIA_WORKSPACE_ROOT: consumerRoots.workspaceRoot,
      SACDIA_CANONICAL_DOCS_ROOT: consumerRoots.docsRoot,
      AUTHORIZATION_P0_VERIFY_DATABASE_URL: url,
      ...extraEnv,
    },
  });
  return { result, report: JSON.parse(result.stdout) as Json };
}
function check(report: Json, id: string): Json {
  return (report.checks as Json[]).find((item) => item.id === id)!;
}

describe('authorization/director succession P0 preflight', () => {
  it('blocks required schema readiness independently of data rows', () => {
    const catalog: CanonicalGeographicIanaTimezoneCatalog = {
      metadata: PINNED_IANA_METADATA,
      canonical: new Set(),
      legacyAliases: new Set(),
      classify: (value) =>
        typeof value === 'string' && value
          ? { ok: true, value }
          : { ok: false, reason: 'MISSING', diagnostic: 'EMPTY' },
    };
    const checks = finalizeChecks(
      {
        schema: {
          local_fields_timezone: 'schema_not_ready',
          director_succession_plans: 'schema_not_ready',
          director_succession_plans_missing_columns: [
            'club_section_id',
            'status',
          ],
        },
        checks: [],
      },
      catalog,
      1,
    );
    expect(checks.find(({ id }) => id === 'required_schema_readiness')).toEqual(
      {
        id: 'required_schema_readiness',
        total_count: 2,
        rows: [
          { resource: 'local_fields.timezone', reason: 'SCHEMA_NOT_READY' },
          {
            resource: 'director_succession_plans',
            reason: 'SCHEMA_NOT_READY',
            missing_columns: ['club_section_id', 'status'],
          },
        ],
        sample_count: 2,
        truncated: false,
      },
    );
  });

  it('distinguishes a pre-connect timeout from a query timeout', () => {
    const timeout = Object.assign(new Error('connection timeout expired'), {
      code: '57014',
    });
    expect(classifyOperationalFailure(timeout, false)).toBe(
      'DATABASE_UNAVAILABLE',
    );
    expect(classifyOperationalFailure(timeout, true)).toBe('QUERY_TIMEOUT');
  });

  it('keeps operational failures machine-readable on the public command', () => {
    const missing = runCli();
    expect([
      missing.result.status,
      (missing.report.error as Json).diagnostic,
    ]).toEqual([1, 'MISSING_DATABASE_URL']);
    for (const extraEnv of [
      { SACDIA_WORKSPACE_ROOT: join(process.cwd(), 'missing-workspace') },
      {
        SACDIA_CANONICAL_DOCS_ROOT: join(process.cwd(), 'missing-docs'),
      },
    ]) {
      const inventory = runCli('postgresql://127.0.0.1:1/postgres', extraEnv);
      expect([
        inventory.result.status,
        (inventory.report.error as Json).diagnostic,
      ]).toEqual([1, 'CONSUMER_INVENTORY_UNAVAILABLE']);
    }
    const unavailable = runCli('postgresql://127.0.0.1:1/postgres', {
      AUTHORIZATION_P0_CONNECTION_TIMEOUT_MS: '100',
    });
    expect([
      unavailable.result.status,
      (unavailable.report.error as Json).diagnostic,
    ]).toEqual([1, 'DATABASE_UNAVAILABLE']);
  });

  dbIt(
    'runs the public CLI read-only with bounded deterministic samples',
    async () => {
      const integrationDatabaseUrl = databaseUrl;
      if (!integrationDatabaseUrl) throw new Error('integration URL required');
      const parsed = new URL(integrationDatabaseUrl);
      const local =
        parsed.searchParams.get('host') === '/tmp' ||
        ['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname);
      expect(local && parsed.pathname === '/postgres').toBe(true);
      const schema = `be01b_${process.pid}_${randomBytes(4).toString('hex')}`;
      const client = new Client({
        connectionString: integrationDatabaseUrl,
        connectionTimeoutMillis: 2_000,
      });
      await client.connect();
      const query = (sql: string) => client.query(sql);
      try {
        await query(`CREATE SCHEMA ${schema}; SET search_path=${schema},public;
        CREATE TABLE roles(role_id uuid,role_name text,role_category text); CREATE TABLE ecclesiastical_years(year_id int,start_date date,end_date date);
        CREATE TABLE club_role_assignments(assignment_id uuid,user_id uuid,role_id uuid,
          ecclesiastical_year_id int,start_date date,end_date date,active boolean,status text,
          expires_at timestamptz,club_section_id int);
        CREATE TABLE users_pr(user_id uuid,active_club_assignment_id uuid); CREATE TABLE classes(class_id int,asset_code text);
        CREATE TABLE audit_logs(audit_log_id bigint,action text); CREATE TABLE local_fields(local_field_id int,name text,union_id int,active boolean);
        CREATE TABLE clubs(club_id int,local_field_id int); CREATE TABLE club_sections(club_section_id int,main_club_id int);
        CREATE TABLE director_succession_plans(stub int);
        INSERT INTO local_fields VALUES(1,'Campo',2,true); INSERT INTO clubs VALUES(1,1);
        INSERT INTO club_sections VALUES(1,1); INSERT INTO classes VALUES(1,'GM-01')`);
        const childEnv = {
          PGOPTIONS: `-csearch_path=${schema},public`,
          AUTHORIZATION_P0_SAMPLE_LIMIT: '2',
        };
        const partial = runCli(integrationDatabaseUrl, childEnv);
        expect([
          partial.result.status,
          (partial.report.schema as Json).local_fields_timezone,
        ]).toEqual([1, 'schema_not_ready']);
        expect(partial.report.consumer_inventory).toMatchObject({
          active_jsx_consumers: [],
          flutter_consumers: [],
        });
        expect(
          (check(partial.report, 'local_field_timezones').rows as Json[])[0],
        ).toMatchObject({ reason: 'MISSING', diagnostic: 'SCHEMA_NOT_READY' });

        await query(
          'BEGIN; LOCK TABLE club_role_assignments IN ACCESS EXCLUSIVE MODE',
        );
        const timeout = runCli(integrationDatabaseUrl, {
          ...childEnv,
          AUTHORIZATION_P0_LOCK_TIMEOUT_MS: '100',
        });
        expect((timeout.report.error as Json).diagnostic).toBe('QUERY_TIMEOUT');
        await query('ROLLBACK');
        await query(`ALTER TABLE local_fields ADD timezone text;
        ALTER TABLE director_succession_plans ADD club_section_id int, ADD status text;
        UPDATE local_fields SET timezone='America/Cancun'`);
        expect(runCli(integrationDatabaseUrl, childEnv).report.status).toBe(
          'clean',
        );

        await query(`INSERT INTO roles VALUES(md5('role')::uuid,'director','CLUB');
        INSERT INTO ecclesiastical_years VALUES(1,'2026-01-01','2026-12-31');
        INSERT INTO club_role_assignments SELECT md5('a'||i)::uuid,md5('u'||i)::uuid,
          CASE WHEN i<3 THEN md5('role')::uuid END,1,
          CASE WHEN i=3 THEN date '2027-02-01' ELSE date '2026-01-01' END,
          CASE WHEN i=3 THEN date '2026-02-01' END,true,
          CASE WHEN i<3 THEN 'active' ELSE 'mystery-'||i END,null,1
          FROM generate_series(1,5)i;
        INSERT INTO users_pr VALUES(md5('preferred')::uuid,md5('missing')::uuid);
        INSERT INTO classes VALUES(2,'GM-01'); INSERT INTO audit_logs VALUES(1,'ACTION_NAME_LONGER_THAN_SIXTY_FOUR_CHARACTERS_FOR_AUDIT_PREFLIGHT');
        UPDATE local_fields SET timezone='EST';
        INSERT INTO director_succession_plans VALUES(1,1,'scheduled')`);
        const blocked = runCli(integrationDatabaseUrl, childEnv);
        expect([blocked.result.status, blocked.report.status]).toEqual([
          1,
          'blocked',
        ]);
        expect(
          check(blocked.report, 'unknown_assignment_statuses'),
        ).toMatchObject({ total_count: 3, sample_count: 2, truncated: true });
        expect(check(blocked.report, 'overlapping_directors').total_count).toBe(
          1,
        );
        expect(check(blocked.report, 'audit_action_length')).toEqual({
          id: 'audit_action_length',
          total_count: 1,
          rows: [
            {
              audit_log_id: '1',
              action:
                'ACTION_NAME_LONGER_THAN_SIXTY_FOUR_CHARACTERS_FOR_AUDIT_PREFLIGHT',
              action_length: 65,
            },
          ],
          sample_count: 1,
          truncated: false,
        });
        expect(
          (check(blocked.report, 'local_field_timezones').rows as Json[])[0],
        ).toMatchObject({
          timezone: 'EST',
          reason: 'DISALLOWED_NAMESPACE',
          diagnostic: 'POSIX_IDENTIFIER',
          scheduled_plans_count: 1,
        });
        expect(runCli(integrationDatabaseUrl, childEnv).report).toEqual(
          blocked.report,
        );
      } finally {
        try {
          await query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
        } finally {
          await client.end();
        }
      }
    },
    30_000,
  );
});
