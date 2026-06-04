import 'dotenv/config';
import { Client } from 'pg';

interface AuditQuery {
  name: string;
  description: string;
  sql: string;
}

const auditQueries: AuditQuery[] = [
  {
    name: 'legacy assignment counts by master honor',
    description:
      'Counts active honors still pointing to the legacy honors.master_honors_id catalog relation.',
    sql: `
      SELECT
        mh.master_honor_id,
        mh.name AS master_honor_name,
        COUNT(h.honor_id)::int AS assigned_honor_count
      FROM master_honors mh
      LEFT JOIN honors h
        ON h.master_honors_id = mh.master_honor_id
       AND h.active = TRUE
      GROUP BY mh.master_honor_id, mh.name
      ORDER BY assigned_honor_count DESC, mh.name ASC
    `,
  },
  {
    name: 'honors assigned to master honor 1',
    description:
      'Lists honors assigned to master_honors_id = 1 for manual review; this relation must not be treated as official rules.',
    sql: `
      SELECT
        h.honor_id,
        h.name AS honor_name,
        h.honors_category_id,
        hc.name AS category_name,
        h.master_honors_id
      FROM honors h
      LEFT JOIN honors_categories hc
        ON hc.honor_category_id = h.honors_category_id
      WHERE h.master_honors_id = 1
      ORDER BY hc.name ASC NULLS LAST, h.name ASC
    `,
  },
  {
    name: 'dangling legacy master honor references',
    description:
      'Finds honors with a legacy master_honors_id that does not exist in master_honors.',
    sql: `
      SELECT
        h.honor_id,
        h.name AS honor_name,
        h.master_honors_id
      FROM honors h
      LEFT JOIN master_honors mh
        ON mh.master_honor_id = h.master_honors_id
      WHERE h.master_honors_id IS NOT NULL
        AND mh.master_honor_id IS NULL
      ORDER BY h.master_honors_id ASC, h.name ASC
    `,
  },
];

function printUsage(): void {
  console.log(`
Usage:
  pnpm exec tsx scripts/audit-master-honor-assignments.ts [--dry-run] [--json]

Environment:
  MASTER_HONOR_AUDIT_DATABASE_URL  Optional. Overrides DATABASE_URL.
  DATABASE_URL                     Used when the override is not set.

Options:
  --dry-run   Print the read-only audit queries without connecting.
  --json      Output query results as JSON.
  --help      Show this help.

Safety:
  - Non-dry runs execute SELECT statements inside a READ ONLY transaction.
  - The script never writes or mutates data.
  - Results are for human review only; do not infer official rules from honors.master_honors_id.
`);
}

function hasFlag(flag: string): boolean {
  return process.argv.includes(flag);
}

async function runAudit(): Promise<Record<string, unknown[]>> {
  const databaseUrl =
    process.env.MASTER_HONOR_AUDIT_DATABASE_URL ?? process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error('Missing DATABASE_URL or MASTER_HONOR_AUDIT_DATABASE_URL');
  }

  const client = new Client({ connectionString: databaseUrl });
  await client.connect();

  try {
    await client.query('BEGIN READ ONLY');
    const results: Record<string, unknown[]> = {};

    for (const query of auditQueries) {
      const result = await client.query(query.sql);
      results[query.name] = result.rows;
    }

    await client.query('COMMIT');
    return results;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    await client.end();
  }
}

async function main(): Promise<void> {
  if (hasFlag('--help') || hasFlag('-h')) {
    printUsage();
    return;
  }

  if (hasFlag('--dry-run')) {
    console.log('Master honor legacy assignment audit queries:');
    for (const query of auditQueries) {
      console.log(
        `\n## ${query.name}\n${query.description}\n${query.sql.trim()}`,
      );
    }
    return;
  }

  const results = await runAudit();

  if (hasFlag('--json')) {
    console.log(JSON.stringify(results, null, 2));
    return;
  }

  console.log('Master honor legacy assignment audit:');
  for (const [name, rows] of Object.entries(results)) {
    console.log(`\n## ${name}`);
    if (!rows.length) {
      console.log('No rows.');
      continue;
    }
    console.table(rows);
  }
}

main().catch((error) => {
  console.error('Master honor legacy assignment audit crashed:', error);
  process.exitCode = 1;
});
