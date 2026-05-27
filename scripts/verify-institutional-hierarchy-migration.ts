import { Client } from 'pg';

interface VerificationCheck {
  name: string;
  sql: string;
}

const checks: VerificationCheck[] = [
  {
    name: 'DIA division exists exactly once',
    sql: `
      SELECT CASE WHEN COUNT(*) = 1 THEN 0 ELSE 1 END::int AS failures
      FROM divisions
      WHERE code = 'DIA'
        AND active = TRUE
    `,
  },
  {
    name: 'All unions have a real division_id',
    sql: `
      SELECT COUNT(*)::int AS failures
      FROM unions
      WHERE division_id IS NULL
         OR division_id <= 0
    `,
  },
  {
    name: 'No scoring category uses origin_id=0',
    sql: `
      SELECT COUNT(*)::int AS failures
      FROM scoring_categories
      WHERE origin_id = 0
    `,
  },
  {
    name: 'Each union has exactly one open division interval',
    sql: `
      SELECT COUNT(*)::int AS failures
      FROM unions u
      LEFT JOIN (
        SELECT union_id, COUNT(*) AS open_count
        FROM union_division_history
        WHERE valid_to IS NULL
        GROUP BY union_id
      ) h ON h.union_id = u.union_id
      WHERE COALESCE(h.open_count, 0) <> 1
    `,
  },
  {
    name: 'Each local field has exactly one open union interval',
    sql: `
      SELECT COUNT(*)::int AS failures
      FROM local_fields lf
      LEFT JOIN (
        SELECT local_field_id, COUNT(*) AS open_count
        FROM local_field_union_history
        WHERE valid_to IS NULL
        GROUP BY local_field_id
      ) h ON h.local_field_id = lf.local_field_id
      WHERE COALESCE(h.open_count, 0) <> 1
    `,
  },
  {
    name: 'Each district has exactly one open local-field interval',
    sql: `
      SELECT COUNT(*)::int AS failures
      FROM districts d
      LEFT JOIN (
        SELECT districlub_type_id, COUNT(*) AS open_count
        FROM district_local_field_history
        WHERE valid_to IS NULL
        GROUP BY districlub_type_id
      ) h ON h.districlub_type_id = d.districlub_type_id
      WHERE COALESCE(h.open_count, 0) <> 1
    `,
  },
  {
    name: 'Each church has exactly one open district interval',
    sql: `
      SELECT COUNT(*)::int AS failures
      FROM churches c
      LEFT JOIN (
        SELECT church_id, COUNT(*) AS open_count
        FROM church_district_history
        WHERE valid_to IS NULL
        GROUP BY church_id
      ) h ON h.church_id = c.church_id
      WHERE COALESCE(h.open_count, 0) <> 1
    `,
  },
  {
    name: 'Each club has exactly one open institutional interval',
    sql: `
      SELECT COUNT(*)::int AS failures
      FROM clubs c
      LEFT JOIN (
        SELECT club_id, COUNT(*) AS open_count
        FROM club_institutional_history
        WHERE valid_to IS NULL
        GROUP BY club_id
      ) h ON h.club_id = c.club_id
      WHERE COALESCE(h.open_count, 0) <> 1
    `,
  },
  {
    name: 'Union division history has no overlaps',
    sql: `
      SELECT COUNT(*)::int AS failures
      FROM union_division_history a
      JOIN union_division_history b
        ON a.union_id = b.union_id
       AND a.union_division_history_id < b.union_division_history_id
       AND daterange(a.valid_from, COALESCE(a.valid_to, 'infinity'::date), '[)')
        && daterange(b.valid_from, COALESCE(b.valid_to, 'infinity'::date), '[)')
    `,
  },
  {
    name: 'Local-field union history has no overlaps',
    sql: `
      SELECT COUNT(*)::int AS failures
      FROM local_field_union_history a
      JOIN local_field_union_history b
        ON a.local_field_id = b.local_field_id
       AND a.local_field_union_history_id < b.local_field_union_history_id
       AND daterange(a.valid_from, COALESCE(a.valid_to, 'infinity'::date), '[)')
        && daterange(b.valid_from, COALESCE(b.valid_to, 'infinity'::date), '[)')
    `,
  },
  {
    name: 'District local-field history has no overlaps',
    sql: `
      SELECT COUNT(*)::int AS failures
      FROM district_local_field_history a
      JOIN district_local_field_history b
        ON a.districlub_type_id = b.districlub_type_id
       AND a.district_local_field_history_id < b.district_local_field_history_id
       AND daterange(a.valid_from, COALESCE(a.valid_to, 'infinity'::date), '[)')
        && daterange(b.valid_from, COALESCE(b.valid_to, 'infinity'::date), '[)')
    `,
  },
  {
    name: 'Church district history has no overlaps',
    sql: `
      SELECT COUNT(*)::int AS failures
      FROM church_district_history a
      JOIN church_district_history b
        ON a.church_id = b.church_id
       AND a.church_district_history_id < b.church_district_history_id
       AND daterange(a.valid_from, COALESCE(a.valid_to, 'infinity'::date), '[)')
        && daterange(b.valid_from, COALESCE(b.valid_to, 'infinity'::date), '[)')
    `,
  },
  {
    name: 'Club institutional history has no overlaps',
    sql: `
      SELECT COUNT(*)::int AS failures
      FROM club_institutional_history a
      JOIN club_institutional_history b
        ON a.club_id = b.club_id
       AND a.club_institutional_history_id < b.club_institutional_history_id
       AND daterange(a.valid_from, COALESCE(a.valid_to, 'infinity'::date), '[)')
        && daterange(b.valid_from, COALESCE(b.valid_to, 'infinity'::date), '[)')
    `,
  },
  {
    name: 'Open union history matches current union FK',
    sql: `
      SELECT COUNT(*)::int AS failures
      FROM unions u
      JOIN union_division_history h
        ON h.union_id = u.union_id
       AND h.valid_to IS NULL
      WHERE h.division_id <> u.division_id
    `,
  },
  {
    name: 'Open local-field history matches current local-field FK',
    sql: `
      SELECT COUNT(*)::int AS failures
      FROM local_fields lf
      JOIN local_field_union_history h
        ON h.local_field_id = lf.local_field_id
       AND h.valid_to IS NULL
      WHERE h.union_id <> lf.union_id
    `,
  },
  {
    name: 'Open district history matches current district FK',
    sql: `
      SELECT COUNT(*)::int AS failures
      FROM districts d
      JOIN district_local_field_history h
        ON h.districlub_type_id = d.districlub_type_id
       AND h.valid_to IS NULL
      WHERE h.local_field_id <> d.local_field_id
    `,
  },
  {
    name: 'Open church history matches current church FK',
    sql: `
      SELECT COUNT(*)::int AS failures
      FROM churches c
      JOIN church_district_history h
        ON h.church_id = c.church_id
       AND h.valid_to IS NULL
      WHERE h.districlub_type_id <> c.districlub_type_id
    `,
  },
  {
    name: 'Open club history matches current club hierarchy',
    sql: `
      SELECT COUNT(*)::int AS failures
      FROM clubs c
      JOIN local_fields lf ON lf.local_field_id = c.local_field_id
      JOIN unions u ON u.union_id = lf.union_id
      JOIN club_institutional_history h
        ON h.club_id = c.club_id
       AND h.valid_to IS NULL
      WHERE h.division_id <> u.division_id
         OR h.union_id <> lf.union_id
         OR h.local_field_id <> c.local_field_id
         OR h.districlub_type_id <> c.districlub_type_id
         OR h.church_id <> c.church_id
    `,
  },
];

function printUsage(): void {
  console.log(`
Usage:
  INSTITUTIONAL_HIERARCHY_VERIFY_DATABASE_URL="postgres://..." pnpm exec tsx scripts/verify-institutional-hierarchy-migration.ts

Options:
  --dry-run   Print the read-only verification checks without connecting.

Safety:
  - The script only runs SELECT statements inside a READ ONLY transaction.
  - It intentionally ignores DATABASE_URL. Use the explicit env var above.
  - Neon URLs are refused unless ALLOW_NEON_INSTITUTIONAL_VERIFY=1 is set.
`);
}

function isNeonUrl(databaseUrl: string): boolean {
  return /(?:neon\.tech|neon\.database)/i.test(databaseUrl);
}

async function main(): Promise<void> {
  if (process.argv.includes('--help') || process.argv.includes('-h')) {
    printUsage();
    return;
  }

  if (process.argv.includes('--dry-run')) {
    console.log('Institutional hierarchy verification checks:');
    for (const check of checks) {
      console.log(`- ${check.name}`);
    }
    return;
  }

  const databaseUrl = process.env.INSTITUTIONAL_HIERARCHY_VERIFY_DATABASE_URL;

  if (!databaseUrl) {
    printUsage();
    throw new Error(
      'Missing INSTITUTIONAL_HIERARCHY_VERIFY_DATABASE_URL. Refusing to use DATABASE_URL implicitly.',
    );
  }

  if (
    isNeonUrl(databaseUrl) &&
    process.env.ALLOW_NEON_INSTITUTIONAL_VERIFY !== '1'
  ) {
    throw new Error(
      'Refusing to connect to a Neon URL without ALLOW_NEON_INSTITUTIONAL_VERIFY=1.',
    );
  }

  const client = new Client({ connectionString: databaseUrl });
  await client.connect();

  try {
    await client.query('BEGIN READ ONLY');

    const failures: string[] = [];

    for (const check of checks) {
      const result = await client.query<{ failures: number }>(check.sql);
      const failureCount = Number(result.rows[0]?.failures ?? 0);

      if (failureCount > 0) {
        failures.push(`${check.name}: ${failureCount}`);
      }
    }

    await client.query('ROLLBACK');

    if (failures.length > 0) {
      console.error('Institutional hierarchy verification failed:');
      for (const failure of failures) {
        console.error(`- ${failure}`);
      }
      process.exitCode = 1;
      return;
    }

    console.log('Institutional hierarchy verification passed.');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    await client.end();
  }
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
