import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, relative, resolve } from 'node:path';
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
type Lifecycle = {
  client?: Client;
  connected: boolean;
  backendPid?: number;
  cancellation?: Promise<void>;
  connectionString?: string;
  cleanup?: Promise<void>;
  signal?: NodeJS.Signals;
};
export const CONSUMER_INVENTORY = Object.freeze([
  'sacdia-admin/src/lib/api/clubs.ts',
  'sacdia-admin/src/lib/clubs/actions.ts',
  'sacdia-admin/src/lib/clubs/actions.test.ts',
  'sacdia-admin/src/lib/auth/director-succession.ts',
  'sacdia-admin/src/lib/auth/director-succession.test.ts',
  'docs/api/ENDPOINTS-LIVE-REFERENCE.md',
  'docs/features/gestion-clubs.md',
  'docs/features/gestion-clubs/ux-reset-phase0.md',
]);
export const CANONICAL_CONTRACT_PHRASES = Object.freeze([
  'El baseline actual sigue ejecutando la sucesión inmediata',
  'Programar la sucesión no termina al director vigente',
  'no crea assignment ni grant',
]);
const CONSUMER_PATTERN =
  /director[-_ ]succession|succeedClubSectionDirector|can_schedule_director_succession/i;
type ConsumerInventory = {
  known_internal_consumers: readonly string[];
  active_jsx_consumers: string[];
  flutter_consumers: string[];
};
export type ConsumerRoots = {
  workspaceRoot?: string;
  adminRoot?: string;
  appRoot?: string;
  docsRoot?: string;
};
export type ResolvedConsumerRoots = {
  adminRoot: string;
  appRoot: string;
  docsRoot: string;
};
export type ContractRefs = {
  adminRef: string;
  appRef: string;
  docsRef: string;
};

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? sourceFiles(path) : [path];
  });
}

function discoverConsumers(
  directory: string,
  sourceRoot: string,
  prefix = '',
): string[] {
  return sourceFiles(directory)
    .filter((path) =>
      CONSUMER_PATTERN.test(`${basename(path)}\n${readFileSync(path, 'utf8')}`),
    )
    .map((path) => join(prefix, relative(sourceRoot, path)))
    .sort();
}

function locateWorkspace(start: string): string {
  if (process.env.SACDIA_WORKSPACE_ROOT)
    return resolve(process.env.SACDIA_WORKSPACE_ROOT);
  for (
    let current = start;
    dirname(current) !== current;
    current = dirname(current)
  )
    if (
      existsSync(join(current, 'sacdia-admin/src')) &&
      existsSync(join(current, 'sacdia-app/lib'))
    )
      return current;
  throw new Error('CONSUMER_INVENTORY_UNAVAILABLE');
}

export function resolveConsumerRoots(
  roots: ConsumerRoots = {},
): ResolvedConsumerRoots {
  const adminRoot = roots.adminRoot ?? process.env.SACDIA_ADMIN_ROOT;
  const appRoot = roots.appRoot ?? process.env.SACDIA_APP_ROOT;
  const workspaceRoot =
    roots.workspaceRoot ?? process.env.SACDIA_WORKSPACE_ROOT;
  const workspace =
    workspaceRoot || !adminRoot || !appRoot
      ? resolve(workspaceRoot ?? locateWorkspace(resolve(__dirname, '..')))
      : undefined;
  return {
    adminRoot: resolve(adminRoot ?? join(workspace!, 'sacdia-admin')),
    appRoot: resolve(appRoot ?? join(workspace!, 'sacdia-app')),
    docsRoot: resolve(
      roots.docsRoot ??
        process.env.SACDIA_CANONICAL_DOCS_ROOT ??
        workspace ??
        locateWorkspace(resolve(__dirname, '..')),
    ),
  };
}

function environmentContractRefs(): ContractRefs | undefined {
  const refs = {
    adminRef: process.env.SACDIA_ADMIN_CONTRACT_REF,
    appRef: process.env.SACDIA_APP_CONTRACT_REF,
    docsRef: process.env.SACDIA_ROOT_CONTRACT_REF,
  };
  const noRefs = Object.values(refs).every((ref) => ref === undefined);
  if (noRefs && process.env.ALLOW_AUTHORIZATION_P0_CROSS_REPO !== '1')
    return undefined;
  if (Object.values(refs).some((ref) => !ref))
    throw new Error('CONSUMER_INVENTORY_REF_MISMATCH');
  return refs as ContractRefs;
}

export function verifyConsumerRootRevisions(
  roots: ResolvedConsumerRoots,
  refs: ContractRefs | undefined = environmentContractRefs(),
): void {
  if (!refs) return;
  try {
    for (const [directory, expected] of [
      [roots.adminRoot, refs.adminRef],
      [roots.appRoot, refs.appRef],
      [roots.docsRoot, refs.docsRef],
    ] as const) {
      if (!/^[0-9a-f]{40}$/.test(expected)) throw new Error();
      const actual = execFileSync(
        'git',
        ['-C', directory, 'rev-parse', 'HEAD'],
        {
          encoding: 'utf8',
        },
      ).trim();
      if (actual !== expected) throw new Error();
    }
  } catch {
    throw new Error('CONSUMER_INVENTORY_REF_MISMATCH');
  }
}

export function verifyCanonicalDocsContract(content: string): void {
  if (CANONICAL_CONTRACT_PHRASES.some((phrase) => !content.includes(phrase)))
    throw new Error('CONSUMER_CONTRACT_DRIFT');
}

export function discoverConsumerInventory(
  roots: ResolvedConsumerRoots,
): ConsumerInventory {
  const required = [
    join(roots.adminRoot, 'src'),
    join(roots.appRoot, 'lib'),
    join(roots.docsRoot, 'docs/api'),
    join(roots.docsRoot, 'docs/features'),
  ];
  if (!required.every((directory) => existsSync(directory)))
    throw new Error('CONSUMER_INVENTORY_UNAVAILABLE');
  let adminConsumers: string[];
  let documentationConsumers: string[];
  let flutterConsumers: string[];
  try {
    adminConsumers = discoverConsumers(
      required[0],
      roots.adminRoot,
      'sacdia-admin',
    );
    flutterConsumers = discoverConsumers(
      required[1],
      roots.appRoot,
      'sacdia-app',
    );
    documentationConsumers = [
      ...discoverConsumers(required[2], roots.docsRoot),
      ...discoverConsumers(required[3], roots.docsRoot),
    ].sort();
  } catch {
    throw new Error('CONSUMER_INVENTORY_UNAVAILABLE');
  }
  const discovered = [
    ...adminConsumers,
    ...flutterConsumers,
    ...documentationConsumers,
  ].sort();
  if (
    JSON.stringify(discovered) !==
    JSON.stringify([...CONSUMER_INVENTORY].sort())
  )
    throw new Error('CONSUMER_INVENTORY_DRIFT');
  return {
    known_internal_consumers: CONSUMER_INVENTORY,
    active_jsx_consumers: adminConsumers.filter((path) =>
      /\.[jt]sx$/i.test(path),
    ),
    flutter_consumers: flutterConsumers,
  };
}

export function inspectConsumerInventory(
  unresolvedRoots: ConsumerRoots = {},
): ConsumerInventory {
  const roots = resolveConsumerRoots(unresolvedRoots);
  verifyConsumerRootRevisions(roots);
  return discoverConsumerInventory(roots);
}

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
let outputWritten = false;
function emit(report: Row, exitCode: number): void {
  if (outputWritten) return;
  outputWritten = true;
  writeFileSync(process.stdout.fd, `${JSON.stringify(report)}\n`);
  console.error(`authorization P0 preflight: ${String(report.status)}`);
  process.exitCode = exitCode;
}

async function cleanup(lifecycle: Lifecycle): Promise<void> {
  if (lifecycle.cleanup) return lifecycle.cleanup;
  lifecycle.cleanup = (async () => {
    await lifecycle.cancellation?.catch(() => undefined);
    const client = lifecycle.client;
    if (!client) return;
    await client.end().catch(() => undefined);
    lifecycle.connected = false;
  })();
  return lifecycle.cleanup;
}

async function cancelActiveQuery(lifecycle: Lifecycle): Promise<void> {
  if (!lifecycle.client) return;
  if (!lifecycle.backendPid || !lifecycle.connectionString) {
    await lifecycle.client.end().catch(() => undefined);
    return;
  }
  const cancellation = new Client({
    connectionString: lifecycle.connectionString,
    connectionTimeoutMillis: 1_000,
    query_timeout: 1_000,
  });
  cancellation.on('error', () => undefined);
  try {
    await cancellation.connect();
    await cancellation.query('SELECT pg_cancel_backend($1)', [
      lifecycle.backendPid,
    ]);
  } finally {
    await cancellation.end().catch(() => undefined);
  }
}

function exitForSignal(signal: NodeJS.Signals): never {
  const interrupted = signal === 'SIGINT';
  const exitCode = interrupted ? 130 : 143;
  emit(errorReport(interrupted ? 'INTERRUPTED' : 'TERMINATED'), exitCode);
  process.exit(exitCode);
}

function installSignalHandlers(lifecycle: Lifecycle): () => void {
  const handler = (signal: NodeJS.Signals) => {
    if (lifecycle.signal) return;
    lifecycle.signal = signal;
    lifecycle.cancellation = cancelActiveQuery(lifecycle);
    if (!lifecycle.backendPid)
      void lifecycle.cancellation.finally(() => exitForSignal(signal));
  };
  const onInterrupt = () => handler('SIGINT');
  const onTerminate = () => handler('SIGTERM');
  process.once('SIGINT', onInterrupt);
  process.once('SIGTERM', onTerminate);
  return () => {
    process.off('SIGINT', onInterrupt);
    process.off('SIGTERM', onTerminate);
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

export function finalizeChecks(
  raw: RawReport,
  catalog: Catalog,
  sampleLimit: number,
) {
  const bootstrap =
    process.env.NODE_ENV === 'production' &&
    process.env.DEV_LOCAL_FIELD_TIMEZONE_BOOTSTRAP === 'true';
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
  const unsupported = [...catalog.canonical]
    .map((timezone) => ({ timezone, result: catalog.classify(timezone) }))
    .filter(({ result }) => !result.ok);
  checks.push({
    id: 'production_node_icu_timezones',
    total_count: unsupported.length,
    rows: unsupported.slice(0, sampleLimit).map(({ timezone, result }) => ({
      timezone,
      ...(!result.ok && {
        reason: result.reason,
        diagnostic: result.diagnostic,
      }),
    })),
    sample_count: Math.min(unsupported.length, sampleLimit),
    truncated: unsupported.length > sampleLimit,
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

async function run(lifecycle: Lifecycle): Promise<Row> {
  const databaseUrl = process.env.AUTHORIZATION_P0_VERIFY_DATABASE_URL;
  if (!databaseUrl) throw new Error('MISSING_DATABASE_URL');
  const consumerInventory = inspectConsumerInventory();
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
  const sampleLimit = setting('AUTHORIZATION_P0_SAMPLE_LIMIT', 50, 100);
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
  lifecycle.client = client;
  lifecycle.connectionString = databaseUrl;
  client.on('error', () => undefined);
  try {
    await client.connect();
    lifecycle.connected = true;
    const backend = await client.query<{ pid: number }>(
      'SELECT pg_backend_pid()::int pid',
    );
    lifecycle.backendPid = backend.rows[0].pid;
    if (lifecycle.signal) throw new Error('PREFLIGHT_INTERRUPTED');
    const raw = await executeAuthorizationP0Preflight(client, {
      canonicalTimezones: [...catalog.canonical],
      sampleLimit,
      now: new Date(),
      statementTimeoutMs: statementTimeout,
      lockTimeoutMs: lockTimeout,
    });
    const checks = finalizeChecks(raw, catalog, sampleLimit);
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
        source: 'sdd/authorization-and-director-succession-p0/design#11.2',
        ...consumerInventory,
        external_consumers_status: 'unknown',
      },
    };
  } catch (error) {
    throw new Error(classifyOperationalFailure(error, lifecycle.connected), {
      cause: error,
    });
  } finally {
    await cleanup(lifecycle);
  }
}

export async function main(): Promise<void> {
  const lifecycle: Lifecycle = { connected: false };
  const removeSignalHandlers = installSignalHandlers(lifecycle);
  try {
    const report = await run(lifecycle);
    if (!lifecycle.signal) emit(report, report.status === 'clean' ? 0 : 1);
  } catch (error) {
    if (!lifecycle.signal) emit(errorReport((error as Error).message), 1);
  } finally {
    await cleanup(lifecycle);
    removeSignalHandlers();
    if (lifecycle.signal) exitForSignal(lifecycle.signal);
  }
}

if (require.main === module) void main();
