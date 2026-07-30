import { Client } from 'pg';
import {
  executeAuthorizationP0Preflight,
  type AuthorizationP0PreflightReport,
} from '../src/common/authorization-p0-preflight';
import { loadCanonicalGeographicIanaTimezoneCatalog } from '../src/common/timezone/canonical-geographic-iana-timezone';

type Row = Record<string, unknown>;
type Catalog = ReturnType<typeof loadCanonicalGeographicIanaTimezoneCatalog>;
type Schema = {
  local_fields_timezone: 'ready' | 'schema_not_ready';
  director_succession_plans: 'ready' | 'schema_not_ready';
  director_succession_plans_missing_columns: string[];
};
type RawReport = AuthorizationP0PreflightReport;
const consumers = [
  'sacdia-admin/src/lib/api/clubs.ts',
  'sacdia-admin/src/lib/clubs/actions.ts',
];
function setting(name: string, fallback: number, maximum: number): number {
  const value = Number(process.env[name]);
  return Number.isInteger(value) && value > 0
    ? Math.min(value, maximum)
    : fallback;
}

function errorReport(diagnostic: string): Row {
  return {
    report_version: 'authorization-director-succession-p0/v1',
    dry_run: true,
    status: 'error',
    error: { diagnostic },
  };
}
function classifyRow(
  id: string,
  row: Row,
  catalog: Catalog,
  schema: Schema,
): Row {
  if (id !== 'local_field_timezones' && row.reason !== 'timezone_unavailable')
    return row;
  if (
    id === 'local_field_timezones' &&
    schema.local_fields_timezone !== 'ready'
  ) {
    return { ...row, reason: 'MISSING', diagnostic: 'SCHEMA_NOT_READY' };
  }
  const result = catalog.classify(
    row.timezone,
    () => row.timezone_supported === true,
  );
  return result.ok
    ? row
    : { ...row, reason: result.reason, diagnostic: result.diagnostic };
}

export function finalizeChecks(raw: RawReport, catalog: Catalog) {
  const bootstrap =
    process.env.NODE_ENV === 'production' &&
    Boolean(process.env.DEV_LOCAL_FIELD_TIMEZONE_BOOTSTRAP);
  const checks = raw.checks.map((check) => ({
    ...check,
    rows: check.rows.map((row) =>
      classifyRow(check.id, row, catalog, raw.schema as Schema),
    ),
  }));
  checks.push({
    id: 'production_timezone_bootstrap',
    total_count: bootstrap ? 1 : 0,
    rows: bootstrap ? [{ reason: 'bootstrap_forbidden_in_production' }] : [],
    sample_count: bootstrap ? 1 : 0,
    truncated: false,
  });
  const schema = raw.schema as Schema;
  const missingSchema = [
    ...(schema.local_fields_timezone === 'ready'
      ? []
      : [{ resource: 'local_fields.timezone', reason: 'SCHEMA_NOT_READY' }]),
    ...(schema.director_succession_plans === 'ready'
      ? []
      : [
          {
            resource: 'director_succession_plans',
            reason: 'SCHEMA_NOT_READY',
            missing_columns: schema.director_succession_plans_missing_columns,
          },
        ]),
  ];
  checks.push({
    id: 'required_schema_readiness',
    total_count: missingSchema.length,
    rows: missingSchema,
    sample_count: missingSchema.length,
    truncated: false,
  });
  return checks.map((check) => ({
    ...check,
    sample_count: check.rows.length,
    truncated: check.total_count > check.rows.length,
  }));
}

export function classifyOperationalFailure(
  error: unknown,
  connected: boolean,
): string {
  if (!connected) return 'DATABASE_UNAVAILABLE';
  const timeout =
    (error as { code?: string }).code === '57014' ||
    String(error).toLowerCase().includes('timeout');
  return timeout ? 'QUERY_TIMEOUT' : 'PREFLIGHT_FAILED';
}

async function run(): Promise<Row> {
  const databaseUrl = process.env.AUTHORIZATION_P0_VERIFY_DATABASE_URL;
  if (!databaseUrl) throw new Error('MISSING_DATABASE_URL');
  let catalog: Catalog;
  try {
    catalog = loadCanonicalGeographicIanaTimezoneCatalog();
  } catch {
    throw new Error('CATALOG_INTEGRITY_ERROR');
  }
  const statementTimeout = setting(
    'AUTHORIZATION_P0_STATEMENT_TIMEOUT_MS',
    5_000,
    60_000,
  );
  const lockTimeout = setting(
    'AUTHORIZATION_P0_LOCK_TIMEOUT_MS',
    1_000,
    10_000,
  );
  const client = new Client({
    connectionString: databaseUrl,
    connectionTimeoutMillis: setting(
      'AUTHORIZATION_P0_CONNECTION_TIMEOUT_MS',
      3_000,
      30_000,
    ),
    statement_timeout: statementTimeout,
    query_timeout: setting('AUTHORIZATION_P0_QUERY_TIMEOUT_MS', 6_000, 65_000),
    lock_timeout: lockTimeout,
    idle_in_transaction_session_timeout: 10_000,
  });
  let connected = false;
  try {
    await client.connect();
    connected = true;
    const raw = await executeAuthorizationP0Preflight(client, {
      canonicalTimezones: [...catalog.canonical],
      sampleLimit: setting('AUTHORIZATION_P0_SAMPLE_LIMIT', 50, 100),
      now: new Date(),
      statementTimeoutMs: statementTimeout,
      lockTimeoutMs: lockTimeout,
    });
    const checks = finalizeChecks(raw, catalog);
    const blockers = checks.filter((check) => check.total_count > 0);
    return {
      report_version: 'authorization-director-succession-p0/v1',
      dry_run: true,
      status: blockers.length === 0 ? 'clean' : 'blocked',
      summary: {
        blocker_checks: blockers.length,
        blocker_rows: blockers.reduce(
          (sum, check) => sum + check.total_count,
          0,
        ),
      },
      schema: raw.schema,
      timezone_catalog: catalog.metadata,
      checks,
      consumer_inventory: {
        known_internal_consumers: consumers,
        external_consumers_status: 'unknown',
      },
    };
  } catch (error) {
    throw new Error(classifyOperationalFailure(error, connected), {
      cause: error,
    });
  } finally {
    await client.end().catch(() => undefined);
  }
}

if (require.main === module)
  void run()
    .then((report) => {
      process.stdout.write(`${JSON.stringify(report)}\n`);
      console.error(`authorization P0 preflight: ${String(report.status)}`);
      process.exitCode = report.status === 'clean' ? 0 : 1;
    })
    .catch((error: Error) => {
      process.stdout.write(`${JSON.stringify(errorReport(error.message))}\n`);
      console.error('authorization P0 preflight: error');
      process.exitCode = 1;
    });
