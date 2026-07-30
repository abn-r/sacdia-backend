import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Client } from 'pg';
import {
  executeAuthorizationP0Preflight,
  executeAuthorizationP0PreflightInTransaction,
} from '../src/common/authorization-p0-preflight';
import {
  loadCanonicalGeographicIanaTimezoneCatalog,
  type CanonicalGeographicIanaTimezoneCatalog,
} from '../src/common/timezone/canonical-geographic-iana-timezone';
import { finalizeChecks } from './verify-authorization-director-succession-p0';

type ActiveLocalField = {
  local_field_id: number;
  name: string;
  timezone: string | null;
};
type BackfillOptions = { mappingPath: string };
type PlannedField = ActiveLocalField & {
  target_timezone: string;
  operation: 'update' | 'unchanged';
};
type Preflight = { schema: Record<string, unknown>; checks: unknown[] };

export class TimezoneBackfillError extends Error {
  constructor(
    readonly code:
      | 'BACKFILL_USAGE'
      | 'BACKFILL_MAPPING_INVALID'
      | 'BACKFILL_SCHEMA_NOT_READY'
      | 'BACKFILL_MAPPING_INCOMPLETE'
      | 'BACKFILL_MAPPING_UNKNOWN_LOCAL_FIELD'
      | 'BACKFILL_GM_01_CARDINALITY_INVALID'
      | 'BACKFILL_POST_PREFLIGHT_BLOCKED'
      | 'BACKFILL_LOCK_TIMEOUT'
      | 'BACKFILL_APPLY_REQUIRES_BE04A2',
    readonly details: Record<string, unknown> = {},
  ) {
    super(code);
  }
}

export function parseBackfillOptions(args: string[]): BackfillOptions {
  let mappingPath: string | undefined;
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === '--apply') {
      throw new TimezoneBackfillError('BACKFILL_APPLY_REQUIRES_BE04A2');
    }
    if (args[index] !== '--mapping' || mappingPath || !args[index + 1]) {
      throw new TimezoneBackfillError('BACKFILL_USAGE');
    }
    mappingPath = args[(index += 1)];
  }
  if (!mappingPath) throw new TimezoneBackfillError('BACKFILL_USAGE');
  return { mappingPath: resolve(mappingPath) };
}

export function parseTimezoneMapping(
  content: string,
  catalog: CanonicalGeographicIanaTimezoneCatalog,
): Map<number, string> {
  let value: unknown;
  try {
    value = JSON.parse(content);
  } catch {
    throw new TimezoneBackfillError('BACKFILL_MAPPING_INVALID');
  }
  if (!value || Array.isArray(value) || typeof value !== 'object') {
    throw new TimezoneBackfillError('BACKFILL_MAPPING_INVALID');
  }
  const mapping = new Map<number, string>();
  for (const [rawId, timezone] of Object.entries(value)) {
    if (!/^[1-9]\d*$/.test(rawId) || typeof timezone !== 'string') {
      throw new TimezoneBackfillError('BACKFILL_MAPPING_INVALID');
    }
    const classification = catalog.classify(timezone);
    if (!classification.ok) {
      throw new TimezoneBackfillError('BACKFILL_MAPPING_INVALID', {
        local_field_id: Number(rawId),
        reason: classification.reason,
      });
    }
    mapping.set(Number(rawId), classification.value);
  }
  return mapping;
}

export function loadTimezoneMapping(
  mappingPath: string,
  catalog: CanonicalGeographicIanaTimezoneCatalog,
): Map<number, string> {
  try {
    return parseTimezoneMapping(readFileSync(mappingPath, 'utf8'), catalog);
  } catch (error) {
    if (error instanceof TimezoneBackfillError) throw error;
    throw new TimezoneBackfillError('BACKFILL_MAPPING_INVALID');
  }
}

async function assertSchemaReady(client: Client): Promise<void> {
  const result = await client.query<{ ready: boolean }>(`SELECT
    EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = current_schema()
      AND table_name = 'local_fields' AND column_name = 'timezone')
    AND to_regclass('authorization_context_versions') IS NOT NULL
    AND to_regclass('director_succession_plans') IS NOT NULL AS ready`);
  if (!result.rows[0]?.ready) {
    throw new TimezoneBackfillError('BACKFILL_SCHEMA_NOT_READY');
  }
}

async function inspectApplyPlan(
  client: Client,
  mapping: ReadonlyMap<number, string>,
): Promise<PlannedField[]> {
  await assertSchemaReady(client);
  const fields =
    await client.query<ActiveLocalField>(`SELECT local_field_id, name, timezone
    FROM local_fields WHERE active = TRUE ORDER BY local_field_id FOR UPDATE`);
  const activeIds = new Set(
    fields.rows.map(({ local_field_id }) => local_field_id),
  );
  const unknown = [...mapping.keys()].filter((id) => !activeIds.has(id));
  if (unknown.length) {
    throw new TimezoneBackfillError('BACKFILL_MAPPING_UNKNOWN_LOCAL_FIELD', {
      local_field_ids: unknown.sort((left, right) => left - right),
    });
  }
  const missing = fields.rows
    .filter(({ local_field_id }) => !mapping.has(local_field_id))
    .map(({ local_field_id, name }) => ({ local_field_id, name }));
  if (missing.length) {
    throw new TimezoneBackfillError('BACKFILL_MAPPING_INCOMPLETE', {
      local_fields: missing,
    });
  }
  const gm = await client.query(
    `SELECT class_id FROM classes WHERE asset_code = 'GM-01'`,
  );
  if (gm.rowCount !== 1) {
    throw new TimezoneBackfillError('BACKFILL_GM_01_CARDINALITY_INVALID', {
      count: gm.rowCount ?? 0,
    });
  }
  return fields.rows.map((field) => ({
    ...field,
    target_timezone: mapping.get(field.local_field_id)!,
    operation:
      field.timezone === mapping.get(field.local_field_id)
        ? ('unchanged' as const)
        : ('update' as const),
  }));
}

export async function planLocalFieldTimezoneBackfill(
  client: Client,
  mapping: ReadonlyMap<number, string>,
): Promise<{ fields: PlannedField[] }> {
  await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
  try {
    await assertSchemaReady(client);
    const fields =
      await client.query<ActiveLocalField>(`SELECT local_field_id, name, timezone
      FROM local_fields WHERE active = TRUE ORDER BY local_field_id`);
    const activeIds = new Set(
      fields.rows.map(({ local_field_id }) => local_field_id),
    );
    const unknown = [...mapping.keys()].filter((id) => !activeIds.has(id));
    if (unknown.length) {
      throw new TimezoneBackfillError('BACKFILL_MAPPING_UNKNOWN_LOCAL_FIELD', {
        local_field_ids: unknown.sort((left, right) => left - right),
      });
    }
    const missing = fields.rows
      .filter(({ local_field_id }) => !mapping.has(local_field_id))
      .map(({ local_field_id, name }) => ({ local_field_id, name }));
    if (missing.length) {
      throw new TimezoneBackfillError('BACKFILL_MAPPING_INCOMPLETE', {
        local_fields: missing,
      });
    }
    const gm = await client.query(`SELECT class_id FROM classes
      WHERE asset_code = 'GM-01'`);
    if (gm.rowCount !== 1) {
      throw new TimezoneBackfillError('BACKFILL_GM_01_CARDINALITY_INVALID', {
        count: gm.rowCount ?? 0,
      });
    }
    const planned = fields.rows.map((field) => ({
      ...field,
      target_timezone: mapping.get(field.local_field_id)!,
      operation:
        field.timezone === mapping.get(field.local_field_id)
          ? ('unchanged' as const)
          : ('update' as const),
    }));
    await client.query('ROLLBACK');
    return { fields: planned };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  }
}

function finalizePreflight(
  raw: Awaited<ReturnType<typeof executeAuthorizationP0Preflight>>,
  catalog: CanonicalGeographicIanaTimezoneCatalog,
): Preflight {
  const checks = finalizeChecks(raw, catalog, 50);
  return {
    schema: raw.schema,
    checks: checks.filter(({ total_count }) => total_count > 0),
  };
}

export async function verifyBackfillPreflight(
  client: Client,
  catalog: CanonicalGeographicIanaTimezoneCatalog,
): Promise<Preflight> {
  const raw = await executeAuthorizationP0Preflight(client, {
    canonicalTimezones: [...catalog.canonical],
    sampleLimit: 50,
    now: new Date(),
    statementTimeoutMs: 5_000,
    lockTimeoutMs: 1_000,
  });
  return finalizePreflight(raw, catalog);
}

export async function applyLocalFieldTimezoneBackfill(
  client: Client,
  mapping: ReadonlyMap<number, string>,
  catalog: CanonicalGeographicIanaTimezoneCatalog,
  correlationId: string,
): Promise<{
  fields: PlannedField[];
  updated_plan_count: number;
  preflight: Preflight;
}> {
  await client.query('BEGIN ISOLATION LEVEL SERIALIZABLE');
  try {
    await client.query(
      `SET LOCAL lock_timeout = '1s'; SET LOCAL statement_timeout = '5s'`,
    );
    const fields = await inspectApplyPlan(client, mapping);
    const changed = fields.filter(({ operation }) => operation === 'update');
    const ids = changed.map(({ local_field_id }) => local_field_id);
    for (const { local_field_id, timezone, target_timezone } of changed) {
      await client.query(
        `UPDATE local_fields SET timezone = $1, modified_at = NOW()
        WHERE local_field_id = $2 AND active = TRUE`,
        [target_timezone, local_field_id],
      );
      await client.query(
        `INSERT INTO audit_logs (entity_type, entity_id, action, event_key,
          actor_kind, actor_scope, target_scope, changes, effective_at,
          correlation_id, idempotency_key, result)
        VALUES ('local_field', $1::text, 'LOCAL_FIELD_TIMEZONE_UPDATED',
          'local-field-timezone.backfill:' || $4::text || ':' || $1::text,
          'system', '{"source":"authorization_p0_timezone_backfill"}',
          jsonb_build_object('local_field_id', $1::int),
          jsonb_build_object('before', jsonb_build_object('timezone', $2::text),
            'after', jsonb_build_object('timezone', $3::text)),
          NOW(), $4::uuid, $4::text, 'succeeded')`,
        [local_field_id, timezone, target_timezone, correlationId],
      );
    }
    let updatedPlanCount = 0;
    if (ids.length) {
      await client.query(
        `INSERT INTO authorization_context_versions (user_id, version, modified_at)
        SELECT DISTINCT assignment.user_id, 1, NOW()
        FROM club_role_assignments assignment JOIN club_sections section USING (club_section_id)
        JOIN clubs club ON club.club_id = section.main_club_id
        WHERE club.local_field_id = ANY($1::int[])
        ON CONFLICT (user_id) DO UPDATE SET version = authorization_context_versions.version + 1,
          modified_at = EXCLUDED.modified_at`,
        [ids],
      );
      const plans = await client.query(
        `UPDATE director_succession_plans
        SET version = version + 1, processing_token = NULL, processing_expires_at = NULL,
          modified_at = NOW()
        WHERE status::text = 'scheduled' AND scheduled_local_field_id = ANY($1::int[])`,
        [ids],
      );
      updatedPlanCount = plans.rowCount ?? 0;
    }
    const raw = await executeAuthorizationP0PreflightInTransaction(client, {
      canonicalTimezones: [...catalog.canonical],
      sampleLimit: 50,
      now: new Date(),
      statementTimeoutMs: 5_000,
      lockTimeoutMs: 1_000,
    });
    const preflight = finalizePreflight(raw, catalog);
    if (preflight.checks.length) {
      throw new TimezoneBackfillError('BACKFILL_POST_PREFLIGHT_BLOCKED', {
        preflight,
      });
    }
    await client.query('COMMIT');
    return { fields, updated_plan_count: updatedPlanCount, preflight };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    if ((error as { code?: string }).code === '55P03') {
      throw new TimezoneBackfillError('BACKFILL_LOCK_TIMEOUT');
    }
    throw error;
  }
}

async function run(options: BackfillOptions) {
  const databaseUrl = process.env.AUTHORIZATION_P0_BACKFILL_DATABASE_URL;
  if (!databaseUrl) throw new Error('MISSING_DATABASE_URL');
  const catalog = loadCanonicalGeographicIanaTimezoneCatalog();
  const mapping = loadTimezoneMapping(options.mappingPath, catalog);
  const client = new Client({ connectionString: databaseUrl });
  try {
    await client.connect();
    const backfill = await planLocalFieldTimezoneBackfill(client, mapping);
    const preflight = await verifyBackfillPreflight(client, catalog);
    return {
      report_version: 'authorization-director-succession-p0/backfill-v1',
      dry_run: true,
      status: 'planned',
      constraint_validation: 'pending_be-04b_human_mapping_gate',
      backfill,
      preflight,
    };
  } finally {
    await client.end();
  }
}

async function main(): Promise<void> {
  try {
    const report = await run(parseBackfillOptions(process.argv.slice(2)));
    process.stdout.write(`${JSON.stringify(report)}\n`);
    process.exitCode = 0;
  } catch (error) {
    const known = error instanceof TimezoneBackfillError ? error : undefined;
    process.stdout.write(
      `${JSON.stringify({
        status: 'error',
        error: {
          diagnostic: known?.code ?? (error as Error).message,
          details: known?.details ?? {},
        },
      })}\n`,
    );
    process.exitCode = 1;
  }
}

if (require.main === module) void main();
