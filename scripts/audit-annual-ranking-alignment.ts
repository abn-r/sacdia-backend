import 'dotenv/config';
import { Client } from 'pg';

import {
  RANKING_COMPONENT_ALIASES,
  RANKING_COMPONENTS,
} from '../src/rankings/annual-ranking-progress/ranking-component-catalog';

interface AuditCheck {
  name: string;
  description: string;
  sql: string;
  params?: unknown[];
}

const acceptedComponentKeys = [
  ...Object.keys(RANKING_COMPONENTS),
  ...Object.keys(RANKING_COMPONENT_ALIASES),
];

const auditChecks: AuditCheck[] = [
  {
    name: 'active configs have active axes',
    description:
      'Every active annual ranking config must have at least one active axis.',
    sql: `
      SELECT COUNT(*)::int AS failures
      FROM annual_ranking_configs c
      WHERE c.active = TRUE
        AND NOT EXISTS (
          SELECT 1
          FROM annual_ranking_axis_configs a
          WHERE a.annual_ranking_config_id = c.annual_ranking_config_id
            AND a.active = TRUE
        )
    `,
  },
  {
    name: 'axis sums equal config max',
    description:
      'The sum of active axis max_points must equal the parent config max_points.',
    sql: `
      SELECT COUNT(*)::int AS failures
      FROM annual_ranking_configs c
      LEFT JOIN (
        SELECT annual_ranking_config_id, SUM(max_points)::int AS axis_max_points
        FROM annual_ranking_axis_configs
        WHERE active = TRUE
        GROUP BY annual_ranking_config_id
      ) axes ON axes.annual_ranking_config_id = c.annual_ranking_config_id
      WHERE c.active = TRUE
        AND COALESCE(axes.axis_max_points, 0) <> c.max_points
    `,
  },
  {
    name: 'component sums equal axis max',
    description:
      'The sum of active component max_points must equal the parent axis max_points.',
    sql: `
      SELECT COUNT(*)::int AS failures
      FROM annual_ranking_axis_configs a
      JOIN annual_ranking_configs c
        ON c.annual_ranking_config_id = a.annual_ranking_config_id
      LEFT JOIN (
        SELECT annual_ranking_axis_config_id, SUM(max_points)::int AS component_max_points
        FROM annual_ranking_component_configs
        WHERE active = TRUE
        GROUP BY annual_ranking_axis_config_id
      ) components
        ON components.annual_ranking_axis_config_id = a.annual_ranking_axis_config_id
      WHERE c.active = TRUE
        AND a.active = TRUE
        AND COALESCE(components.component_max_points, 0) <> a.max_points
    `,
  },
  {
    name: 'component keys are canonical or accepted legacy aliases',
    description:
      'Active component configs must use a canonical component key or an accepted legacy alias.',
    sql: `
      SELECT COUNT(*)::int AS failures
      FROM annual_ranking_component_configs component
      JOIN annual_ranking_configs config
        ON config.annual_ranking_config_id = component.annual_ranking_config_id
      WHERE config.active = TRUE
        AND component.active = TRUE
        AND component.component_key <> ALL($1::text[])
    `,
    params: [acceptedComponentKeys],
  },
  {
    name: 'folder template max matches evaluation max',
    description:
      'For each annual folder, template section max_points must match eager evaluation-row max_points.',
    sql: `
      SELECT COUNT(*)::int AS failures
      FROM annual_folders folder
      LEFT JOIN (
        SELECT folder_template_id, SUM(max_points)::int AS template_max_points
        FROM folder_template_sections
        GROUP BY folder_template_id
      ) template_points
        ON template_points.folder_template_id = folder.folder_template_id
      LEFT JOIN (
        SELECT annual_folder_id, SUM(max_points)::int AS evaluation_max_points
        FROM annual_folder_section_evaluations
        GROUP BY annual_folder_id
      ) evaluation_points
        ON evaluation_points.annual_folder_id = folder.annual_folder_id
      WHERE COALESCE(template_points.template_max_points, 0)
        <> COALESCE(evaluation_points.evaluation_max_points, 0)
    `,
  },
  {
    name: 'active configs have no orphan components',
    description:
      'Active component configs must be attached to an active axis in the same config.',
    sql: `
      SELECT COUNT(*)::int AS failures
      FROM annual_ranking_component_configs component
      JOIN annual_ranking_configs config
        ON config.annual_ranking_config_id = component.annual_ranking_config_id
      LEFT JOIN annual_ranking_axis_configs axis
        ON axis.annual_ranking_axis_config_id = component.annual_ranking_axis_config_id
       AND axis.annual_ranking_config_id = component.annual_ranking_config_id
       AND axis.active = TRUE
      WHERE config.active = TRUE
        AND component.active = TRUE
        AND axis.annual_ranking_axis_config_id IS NULL
    `,
  },
];

function printUsage(): void {
  console.log(`
Usage:
  pnpm exec tsx scripts/audit-annual-ranking-alignment.ts [--dry-run]

Environment:
  ANNUAL_RANKING_AUDIT_DATABASE_URL  Optional. Overrides DATABASE_URL.
  DATABASE_URL                       Used when the override is not set.

Options:
  --dry-run   Print the read-only checks without connecting to the database.
  --help      Show this help.

Safety:
  - Non-dry runs execute SELECT statements inside a READ ONLY transaction.
  - The script never writes or mutates data.
`);
}

async function runAudit(): Promise<number> {
  const databaseUrl =
    process.env.ANNUAL_RANKING_AUDIT_DATABASE_URL ?? process.env.DATABASE_URL;

  if (!databaseUrl) {
    throw new Error(
      'Missing DATABASE_URL or ANNUAL_RANKING_AUDIT_DATABASE_URL',
    );
  }

  const client = new Client({ connectionString: databaseUrl });
  await client.connect();

  let totalFailures = 0;

  try {
    await client.query('BEGIN READ ONLY');

    console.log('Annual ranking alignment audit:');

    for (const check of auditChecks) {
      const result = await client.query<{ failures: number }>(
        check.sql,
        check.params ?? [],
      );
      const failures = Number(result.rows[0]?.failures ?? 0);
      totalFailures += failures;

      console.log(
        `${failures === 0 ? '✅' : '❌'} ${check.name}: ${failures} failure(s)`,
      );
    }

    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    await client.end();
  }

  return totalFailures;
}

async function main(): Promise<void> {
  if (process.argv.includes('--help') || process.argv.includes('-h')) {
    printUsage();
    return;
  }

  if (process.argv.includes('--dry-run')) {
    console.log('Annual ranking alignment audit checks:');
    for (const check of auditChecks) {
      console.log(`- ${check.name}: ${check.description}`);
    }
    console.log(`Accepted component keys: ${acceptedComponentKeys.join(', ')}`);
    return;
  }

  const failures = await runAudit();
  if (failures > 0) {
    process.exitCode = 1;
    console.error(
      `Annual ranking alignment audit failed: ${failures} issue(s)`,
    );
    return;
  }

  console.log('Annual ranking alignment audit passed');
}

main().catch((error) => {
  console.error('Annual ranking alignment audit crashed:', error);
  process.exitCode = 1;
});
