import { Client } from 'pg';
import { buildRecursiveProhibitedContextKeysSql } from '../src/institutional-history/sensitive-context.policy';

export interface VerificationCheck {
  name: string;
  sql: string;
}

function openRelationshipFailuresSql(): string {
  return `
    SELECT (
      (SELECT COUNT(*)::int
       FROM unions u
       LEFT JOIN (
         SELECT union_id, COUNT(*) AS open_count
         FROM union_division_history
         WHERE recorded_to IS NULL AND valid_to IS NULL
         GROUP BY union_id
       ) h ON h.union_id = u.union_id
       WHERE COALESCE(h.open_count, 0) <> 1)
      +
      (SELECT COUNT(*)::int
       FROM local_fields lf
       LEFT JOIN (
         SELECT local_field_id, COUNT(*) AS open_count
         FROM local_field_union_history
         WHERE recorded_to IS NULL AND valid_to IS NULL
         GROUP BY local_field_id
       ) h ON h.local_field_id = lf.local_field_id
       WHERE COALESCE(h.open_count, 0) <> 1)
      +
      (SELECT COUNT(*)::int
       FROM districts d
       LEFT JOIN (
         SELECT districlub_type_id, COUNT(*) AS open_count
         FROM district_local_field_history
         WHERE recorded_to IS NULL AND valid_to IS NULL
         GROUP BY districlub_type_id
       ) h ON h.districlub_type_id = d.districlub_type_id
       WHERE COALESCE(h.open_count, 0) <> 1)
      +
      (SELECT COUNT(*)::int
       FROM churches c
       LEFT JOIN (
         SELECT church_id, COUNT(*) AS open_count
         FROM church_district_history
         WHERE recorded_to IS NULL AND valid_to IS NULL
         GROUP BY church_id
       ) h ON h.church_id = c.church_id
       WHERE COALESCE(h.open_count, 0) <> 1)
      +
      (SELECT COUNT(*)::int
       FROM clubs c
       LEFT JOIN (
         SELECT club_id, COUNT(*) AS open_count
         FROM club_institutional_history
         WHERE recorded_to IS NULL AND valid_to IS NULL
         GROUP BY club_id
       ) h ON h.club_id = c.club_id
       WHERE COALESCE(h.open_count, 0) <> 1)
    )::int AS failures
  `;
}

function openNameVersionFailuresSql(): string {
  return `
    SELECT (
      (SELECT COUNT(*)::int
       FROM divisions d
       LEFT JOIN (
         SELECT division_id, COUNT(*) AS open_count
         FROM institutional_name_versions
         WHERE division_id IS NOT NULL
           AND recorded_to IS NULL
           AND valid_to IS NULL
         GROUP BY division_id
       ) n ON n.division_id = d.division_id
       WHERE COALESCE(n.open_count, 0) <> 1)
      +
      (SELECT COUNT(*)::int
       FROM unions u
       LEFT JOIN (
         SELECT union_id, COUNT(*) AS open_count
         FROM institutional_name_versions
         WHERE union_id IS NOT NULL
           AND recorded_to IS NULL
           AND valid_to IS NULL
         GROUP BY union_id
       ) n ON n.union_id = u.union_id
       WHERE COALESCE(n.open_count, 0) <> 1)
      +
      (SELECT COUNT(*)::int
       FROM local_fields lf
       LEFT JOIN (
         SELECT local_field_id, COUNT(*) AS open_count
         FROM institutional_name_versions
         WHERE local_field_id IS NOT NULL
           AND recorded_to IS NULL
           AND valid_to IS NULL
         GROUP BY local_field_id
       ) n ON n.local_field_id = lf.local_field_id
       WHERE COALESCE(n.open_count, 0) <> 1)
      +
      (SELECT COUNT(*)::int
       FROM districts d
       LEFT JOIN (
         SELECT districlub_type_id, COUNT(*) AS open_count
         FROM institutional_name_versions
         WHERE districlub_type_id IS NOT NULL
           AND recorded_to IS NULL
           AND valid_to IS NULL
         GROUP BY districlub_type_id
       ) n ON n.districlub_type_id = d.districlub_type_id
       WHERE COALESCE(n.open_count, 0) <> 1)
      +
      (SELECT COUNT(*)::int
       FROM churches c
       LEFT JOIN (
         SELECT church_id, COUNT(*) AS open_count
         FROM institutional_name_versions
         WHERE church_id IS NOT NULL
           AND recorded_to IS NULL
           AND valid_to IS NULL
         GROUP BY church_id
       ) n ON n.church_id = c.church_id
       WHERE COALESCE(n.open_count, 0) <> 1)
      +
      (SELECT COUNT(*)::int
       FROM clubs c
       LEFT JOIN (
         SELECT club_id, COUNT(*) AS open_count
         FROM institutional_name_versions
         WHERE club_id IS NOT NULL
           AND recorded_to IS NULL
           AND valid_to IS NULL
         GROUP BY club_id
       ) n ON n.club_id = c.club_id
       WHERE COALESCE(n.open_count, 0) <> 1)
    )::int AS failures
  `;
}

export const INSTITUTIONAL_HIERARCHY_CHECKS: VerificationCheck[] = [
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
    name: 'Each entity has exactly one open effective relationship revision',
    sql: openRelationshipFailuresSql(),
  },
  {
    name: 'Each entity has exactly one open name version',
    sql: openNameVersionFailuresSql(),
  },
  {
    name: 'Current projection matches the revision covering CURRENT_DATE',
    sql: `
      SELECT (
        (SELECT COUNT(*)::int
         FROM unions u
         WHERE NOT EXISTS (
           SELECT 1
           FROM union_division_history h
           WHERE h.union_id = u.union_id
             AND h.recorded_to IS NULL
             AND h.valid_from <= CURRENT_DATE
             AND (h.valid_to IS NULL OR h.valid_to > CURRENT_DATE)
             AND h.division_id = u.division_id
         ))
        +
        (SELECT COUNT(*)::int
         FROM local_fields lf
         WHERE NOT EXISTS (
           SELECT 1
           FROM local_field_union_history h
           WHERE h.local_field_id = lf.local_field_id
             AND h.recorded_to IS NULL
             AND h.valid_from <= CURRENT_DATE
             AND (h.valid_to IS NULL OR h.valid_to > CURRENT_DATE)
             AND h.union_id = lf.union_id
         ))
        +
        (SELECT COUNT(*)::int
         FROM districts d
         WHERE NOT EXISTS (
           SELECT 1
           FROM district_local_field_history h
           WHERE h.districlub_type_id = d.districlub_type_id
             AND h.recorded_to IS NULL
             AND h.valid_from <= CURRENT_DATE
             AND (h.valid_to IS NULL OR h.valid_to > CURRENT_DATE)
             AND h.local_field_id = d.local_field_id
         ))
        +
        (SELECT COUNT(*)::int
         FROM churches c
         WHERE NOT EXISTS (
           SELECT 1
           FROM church_district_history h
           WHERE h.church_id = c.church_id
             AND h.recorded_to IS NULL
             AND h.valid_from <= CURRENT_DATE
             AND (h.valid_to IS NULL OR h.valid_to > CURRENT_DATE)
             AND h.districlub_type_id = c.districlub_type_id
         ))
        +
        (SELECT COUNT(*)::int
         FROM clubs c
         JOIN local_fields lf ON lf.local_field_id = c.local_field_id
         JOIN unions u ON u.union_id = lf.union_id
         WHERE NOT EXISTS (
           SELECT 1
           FROM club_institutional_history h
           WHERE h.club_id = c.club_id
             AND h.recorded_to IS NULL
             AND h.valid_from <= CURRENT_DATE
             AND (h.valid_to IS NULL OR h.valid_to > CURRENT_DATE)
             AND h.division_id = u.division_id
             AND h.union_id = lf.union_id
             AND h.local_field_id = c.local_field_id
             AND h.districlub_type_id = c.districlub_type_id
             AND h.church_id = c.church_id
         ))
      )::int AS failures
    `,
  },
  {
    name: 'Current name projection matches the name version covering CURRENT_DATE',
    sql: `
      SELECT (
        (SELECT COUNT(*)::int
         FROM divisions d
         WHERE NOT EXISTS (
           SELECT 1
           FROM institutional_name_versions n
           WHERE n.division_id = d.division_id
             AND n.recorded_to IS NULL
             AND n.valid_from <= CURRENT_DATE
             AND (n.valid_to IS NULL OR n.valid_to > CURRENT_DATE)
             AND n.name = d.name
             AND n.abbreviation IS NOT DISTINCT FROM d.abbreviation
         ))
        +
        (SELECT COUNT(*)::int
         FROM unions u
         WHERE NOT EXISTS (
           SELECT 1
           FROM institutional_name_versions n
           WHERE n.union_id = u.union_id
             AND n.recorded_to IS NULL
             AND n.valid_from <= CURRENT_DATE
             AND (n.valid_to IS NULL OR n.valid_to > CURRENT_DATE)
             AND n.name = u.name
             AND n.abbreviation IS NOT DISTINCT FROM u.abbreviation
         ))
        +
        (SELECT COUNT(*)::int
         FROM local_fields lf
         WHERE NOT EXISTS (
           SELECT 1
           FROM institutional_name_versions n
           WHERE n.local_field_id = lf.local_field_id
             AND n.recorded_to IS NULL
             AND n.valid_from <= CURRENT_DATE
             AND (n.valid_to IS NULL OR n.valid_to > CURRENT_DATE)
             AND n.name = lf.name
             AND n.abbreviation IS NOT DISTINCT FROM lf.abbreviation
         ))
        +
        (SELECT COUNT(*)::int
         FROM districts d
         WHERE NOT EXISTS (
           SELECT 1
           FROM institutional_name_versions n
           WHERE n.districlub_type_id = d.districlub_type_id
             AND n.recorded_to IS NULL
             AND n.valid_from <= CURRENT_DATE
             AND (n.valid_to IS NULL OR n.valid_to > CURRENT_DATE)
             AND n.name = d.name
         ))
        +
        (SELECT COUNT(*)::int
         FROM churches c
         WHERE NOT EXISTS (
           SELECT 1
           FROM institutional_name_versions n
           WHERE n.church_id = c.church_id
             AND n.recorded_to IS NULL
             AND n.valid_from <= CURRENT_DATE
             AND (n.valid_to IS NULL OR n.valid_to > CURRENT_DATE)
             AND n.name = c.name
         ))
        +
        (SELECT COUNT(*)::int
         FROM clubs c
         WHERE NOT EXISTS (
           SELECT 1
           FROM institutional_name_versions n
           WHERE n.club_id = c.club_id
             AND n.recorded_to IS NULL
             AND n.valid_from <= CURRENT_DATE
             AND (n.valid_to IS NULL OR n.valid_to > CURRENT_DATE)
             AND n.name = c.name
         ))
      )::int AS failures
    `,
  },
  {
    name: 'Recorded relationship revisions have zero overlaps',
    sql: `
      SELECT (
        (SELECT COUNT(*)::int
         FROM union_division_history a
         JOIN union_division_history b
           ON a.union_id = b.union_id
          AND a.union_division_history_id < b.union_division_history_id
          AND a.recorded_to IS NULL
          AND b.recorded_to IS NULL
          AND daterange(a.valid_from, COALESCE(a.valid_to, 'infinity'::date), '[)')
           && daterange(b.valid_from, COALESCE(b.valid_to, 'infinity'::date), '[)'))
        +
        (SELECT COUNT(*)::int
         FROM local_field_union_history a
         JOIN local_field_union_history b
           ON a.local_field_id = b.local_field_id
          AND a.local_field_union_history_id < b.local_field_union_history_id
          AND a.recorded_to IS NULL
          AND b.recorded_to IS NULL
          AND daterange(a.valid_from, COALESCE(a.valid_to, 'infinity'::date), '[)')
           && daterange(b.valid_from, COALESCE(b.valid_to, 'infinity'::date), '[)'))
        +
        (SELECT COUNT(*)::int
         FROM district_local_field_history a
         JOIN district_local_field_history b
           ON a.districlub_type_id = b.districlub_type_id
          AND a.district_local_field_history_id < b.district_local_field_history_id
          AND a.recorded_to IS NULL
          AND b.recorded_to IS NULL
          AND daterange(a.valid_from, COALESCE(a.valid_to, 'infinity'::date), '[)')
           && daterange(b.valid_from, COALESCE(b.valid_to, 'infinity'::date), '[)'))
        +
        (SELECT COUNT(*)::int
         FROM church_district_history a
         JOIN church_district_history b
           ON a.church_id = b.church_id
          AND a.church_district_history_id < b.church_district_history_id
          AND a.recorded_to IS NULL
          AND b.recorded_to IS NULL
          AND daterange(a.valid_from, COALESCE(a.valid_to, 'infinity'::date), '[)')
           && daterange(b.valid_from, COALESCE(b.valid_to, 'infinity'::date), '[)'))
        +
        (SELECT COUNT(*)::int
         FROM club_institutional_history a
         JOIN club_institutional_history b
           ON a.club_id = b.club_id
          AND a.club_institutional_history_id < b.club_institutional_history_id
          AND a.recorded_to IS NULL
          AND b.recorded_to IS NULL
          AND daterange(a.valid_from, COALESCE(a.valid_to, 'infinity'::date), '[)')
           && daterange(b.valid_from, COALESCE(b.valid_to, 'infinity'::date), '[)'))
      )::int AS failures
    `,
  },
  {
    name: 'Recorded name versions have zero overlaps',
    sql: `
      SELECT COUNT(*)::int AS failures
      FROM institutional_name_versions a
      JOIN institutional_name_versions b
        ON a.name_version_id < b.name_version_id
       AND a.recorded_to IS NULL
       AND b.recorded_to IS NULL
       AND (
         (a.division_id IS NOT NULL AND a.division_id = b.division_id)
         OR (a.union_id IS NOT NULL AND a.union_id = b.union_id)
         OR (a.local_field_id IS NOT NULL AND a.local_field_id = b.local_field_id)
         OR (a.districlub_type_id IS NOT NULL AND a.districlub_type_id = b.districlub_type_id)
         OR (a.church_id IS NOT NULL AND a.church_id = b.church_id)
         OR (a.club_id IS NOT NULL AND a.club_id = b.club_id)
       )
       AND daterange(a.valid_from, COALESCE(a.valid_to, 'infinity'::date), '[)')
        && daterange(b.valid_from, COALESCE(b.valid_to, 'infinity'::date), '[)')
    `,
  },
  {
    name: 'Reorganization participants never have ambiguous typed FKs',
    sql: `
      SELECT COUNT(*)::int AS failures
      FROM institutional_reorganization_participants
      WHERE (
        (CASE WHEN division_id IS NOT NULL THEN 1 ELSE 0 END) +
        (CASE WHEN union_id IS NOT NULL THEN 1 ELSE 0 END) +
        (CASE WHEN local_field_id IS NOT NULL THEN 1 ELSE 0 END) +
        (CASE WHEN districlub_type_id IS NOT NULL THEN 1 ELSE 0 END) +
        (CASE WHEN church_id IS NOT NULL THEN 1 ELSE 0 END) +
        (CASE WHEN club_id IS NOT NULL THEN 1 ELSE 0 END)
      ) <> 1
    `,
  },
  {
    name: 'hierarchy_contexts rows always have JSON context and precision',
    sql: `
      SELECT COUNT(*)::int AS failures
      FROM hierarchy_contexts
      WHERE context IS NULL
         OR precision IS NULL
         OR btrim(precision) = ''
    `,
  },
  {
    name: 'Applied reorganizations always have participants',
    sql: `
      SELECT COUNT(*)::int AS failures
      FROM institutional_reorganizations r
      WHERE NOT EXISTS (
        SELECT 1
        FROM institutional_reorganization_participants p
        WHERE p.reorganization_id = r.reorganization_id
      )
    `,
  },
  {
    name: 'Applied reorganizations always have audit linkage',
    sql: `
      SELECT COUNT(*)::int AS failures
      FROM institutional_reorganizations r
      WHERE NOT EXISTS (
        SELECT 1
        FROM audit_logs a
        WHERE a.entity_type = 'institutional_reorganization'
          AND a.entity_id = r.reorganization_id::text
      )
    `,
  },
  {
    name: 'hierarchy_contexts.context never stores prohibited sensitive keys',
    sql: buildRecursiveProhibitedContextKeysSql(),
  },
];

export function listVerificationCheckNames(): string[] {
  return INSTITUTIONAL_HIERARCHY_CHECKS.map((check) => check.name);
}

export function isNeonUrl(databaseUrl: string): boolean {
  return /(?:neon\.tech|neon\.database)/i.test(databaseUrl);
}

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

async function main(): Promise<void> {
  if (process.argv.includes('--help') || process.argv.includes('-h')) {
    printUsage();
    return;
  }

  if (process.argv.includes('--dry-run')) {
    console.log('Institutional hierarchy verification checks:');
    for (const check of INSTITUTIONAL_HIERARCHY_CHECKS) {
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
    const counts: Array<{ name: string; failures: number }> = [];

    for (const check of INSTITUTIONAL_HIERARCHY_CHECKS) {
      const result = await client.query<{ failures: number }>(check.sql);
      const failureCount = Number(result.rows[0]?.failures ?? 0);
      counts.push({ name: check.name, failures: failureCount });

      if (failureCount > 0) {
        failures.push(`${check.name}: ${failureCount}`);
      }
    }

    await client.query('ROLLBACK');

    console.log('Institutional hierarchy verification counts:');
    for (const count of counts) {
      console.log(`- ${count.name}: ${count.failures}`);
    }

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

if (require.main === module) {
  void main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
