import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Client } from 'pg';

type JsonRow = Record<string, unknown>;

export interface AuthorizationP0PreflightCheck {
  id: string;
  total_count: number;
  rows: JsonRow[];
  sample_count: number;
  truncated: boolean;
}

export interface AuthorizationP0PreflightReport {
  schema: {
    director_succession_plans: string;
    [key: string]: unknown;
  };
  checks: AuthorizationP0PreflightCheck[];
}

export interface AuthorizationP0PreflightOptions {
  canonicalTimezones: readonly string[];
  sampleLimit: number | null;
  now: Date;
  statementTimeoutMs: number;
  lockTimeoutMs: number;
}

export function loadAuthorizationP0PreflightSql(
  moduleDirectory = __dirname,
): string {
  try {
    return readFileSync(
      resolve(
        moduleDirectory,
        '../../prisma/scripts/authorization-p0-preflight.sql',
      ),
      'utf8',
    );
  } catch (cause) {
    throw new Error('AUTHORIZATION_P0_PREFLIGHT_SQL_UNAVAILABLE', { cause });
  }
}

function validateOptions(options: AuthorizationP0PreflightOptions): void {
  const validTimeout = (value: number) =>
    Number.isSafeInteger(value) && value > 0;
  if (
    !Array.isArray(options.canonicalTimezones) ||
    options.canonicalTimezones.length === 0 ||
    options.canonicalTimezones.some(
      (timezone) => typeof timezone !== 'string' || timezone.length === 0,
    ) ||
    (options.sampleLimit !== null &&
      !Number.isSafeInteger(options.sampleLimit)) ||
    !(options.now instanceof Date) ||
    !Number.isFinite(options.now.getTime()) ||
    !validTimeout(options.statementTimeoutMs) ||
    !validTimeout(options.lockTimeoutMs)
  )
    throw new Error('AUTHORIZATION_P0_PREFLIGHT_OPTIONS_INVALID');
}

export async function executeAuthorizationP0Preflight(
  client: Client,
  options: AuthorizationP0PreflightOptions,
): Promise<AuthorizationP0PreflightReport> {
  validateOptions(options);
  const preflightSql = loadAuthorizationP0PreflightSql();
  let transactionStarted = false;
  try {
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    transactionStarted = true;
    const contract = await client.query<{
      isolation: string;
      read_only: string;
    }>(
      `SELECT current_setting('transaction_isolation') isolation,
       current_setting('transaction_read_only') read_only,
       set_config('statement_timeout',
         greatest(1, least($1::int, 60000))::text, true),
       set_config('lock_timeout',
         greatest(1, least($2::int, 10000))::text, true)`,
      [options.statementTimeoutMs, options.lockTimeoutMs],
    );
    if (
      contract.rows[0]?.isolation !== 'repeatable read' ||
      contract.rows[0]?.read_only !== 'on'
    )
      throw new Error('AUTHORIZATION_P0_PREFLIGHT_TRANSACTION_REJECTED');
    const result = await client.query<{
      report: AuthorizationP0PreflightReport;
    }>(preflightSql, [
      options.canonicalTimezones,
      options.sampleLimit,
      options.now,
    ]);
    const report = result.rows[0].report;
    const fields = report.checks.find(
      (item) => item.id === 'local_field_timezones',
    )?.rows;
    const ids = (fields ?? [])
      .map((row) => row.local_field_id)
      .filter((id): id is number => typeof id === 'number');
    if (report.schema.director_succession_plans === 'ready' && ids.length > 0) {
      const plans = await client.query<{
        local_field_id: number;
        scheduled_plans_count: number;
      }>(
        `SELECT c.local_field_id, count(*)::int scheduled_plans_count
         FROM director_succession_plans p JOIN club_sections s USING (club_section_id)
         JOIN clubs c ON c.club_id = s.main_club_id
         WHERE p.status::text = 'scheduled' AND c.local_field_id = ANY($1::int[])
         GROUP BY c.local_field_id`,
        [ids],
      );
      const counts = new Map(
        plans.rows.map((row) => [
          row.local_field_id,
          row.scheduled_plans_count,
        ]),
      );
      for (const row of fields ?? [])
        row.scheduled_plans_count =
          counts.get(row.local_field_id as number) ?? 0;
    }
    await client.query('COMMIT');
    transactionStarted = false;
    return report;
  } catch (error) {
    if (transactionStarted) {
      try {
        await client.query('ROLLBACK');
      } catch (rollbackError) {
        throw new AggregateError(
          [error, rollbackError],
          'AUTHORIZATION_P0_PREFLIGHT_ROLLBACK_FAILED',
          { cause: rollbackError },
        );
      }
    }
    throw error;
  }
}
