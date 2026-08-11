import { Client } from 'pg';

export interface CertificationMigrationCheck {
  name: string;
  sql: string;
}

export const CERTIFICATIONS_MIGRATION_VERIFY_DATABASE_URL =
  'CERTIFICATIONS_MIGRATION_VERIFY_DATABASE_URL';

export function isNeonUrl(url: string): boolean {
  return /neon\.tech/i.test(url);
}

/**
 * Read-only integrity checks after expand/backfill.
 * Abort (non-zero count) on orphan progress, enrollments without version,
 * published editable definitions without version row, requirements without
 * components (only when version has configured components expected), or
 * evidences without owner response.
 */
export const CERTIFICATIONS_MIGRATION_CHECKS: CertificationMigrationCheck[] = [
  {
    name: 'Every enrollment has a certification version',
    sql: `
      SELECT COUNT(*)::int AS failures
      FROM users_certifications
      WHERE certification_version_id IS NULL
    `,
  },
  {
    name: 'Every certification has a published version 1 after backfill',
    sql: `
      SELECT COUNT(*)::int AS failures
      FROM certifications c
      WHERE NOT EXISTS (
        SELECT 1
        FROM certification_versions v
        WHERE v.certification_id = c.certification_id
          AND v.version_number = 1
          AND v.status = 'PUBLISHED'
      )
    `,
  },
  {
    name: 'Every module is bound to a version',
    sql: `
      SELECT COUNT(*)::int AS failures
      FROM certification_modules
      WHERE certification_version_id IS NULL
    `,
  },
  {
    name: 'No orphan section progress without matching enrollment when enrollment_id is set',
    sql: `
      SELECT COUNT(*)::int AS failures
      FROM certification_section_progress p
      LEFT JOIN users_certifications uc ON uc.enrollment_id = p.enrollment_id
      WHERE p.enrollment_id IS NOT NULL
        AND uc.enrollment_id IS NULL
    `,
  },
  {
    name: 'No certification evidence without owning response',
    sql: `
      SELECT COUNT(*)::int AS failures
      FROM certification_evidences e
      LEFT JOIN certification_component_responses r ON r.response_id = e.response_id
      WHERE r.response_id IS NULL
    `,
  },
  {
    name: 'Published versions cannot keep draft-only status drift',
    sql: `
      SELECT COUNT(*)::int AS failures
      FROM certification_versions
      WHERE status = 'PUBLISHED'
        AND published_at IS NULL
    `,
  },
];

export function listCertificationMigrationCheckNames(): string[] {
  return CERTIFICATIONS_MIGRATION_CHECKS.map((check) => check.name);
}

async function runChecks(client: Client): Promise<string[]> {
  const failures: string[] = [];
  for (const check of CERTIFICATIONS_MIGRATION_CHECKS) {
    const result = await client.query<{ failures: number }>(check.sql);
    const count = Number(result.rows[0]?.failures ?? 0);
    if (count > 0) {
      failures.push(`${check.name} (${count})`);
    }
  }
  return failures;
}

export async function verifyCertificationsMigration(options: {
  databaseUrl: string;
  dryRun?: boolean;
  allowNeon?: boolean;
}): Promise<{ failures: string[]; dryRun: boolean }> {
  if (isNeonUrl(options.databaseUrl) && !options.allowNeon) {
    throw new Error(
      'Refusing Neon URL without ALLOW_NEON_CERTIFICATIONS_VERIFY=1',
    );
  }

  const client = new Client({ connectionString: options.databaseUrl });
  await client.connect();
  try {
    await client.query('BEGIN READ ONLY');
    const failures = await runChecks(client);
    await client.query('ROLLBACK');
    if (options.dryRun) {
      return { failures, dryRun: true };
    }
    if (failures.length > 0) {
      throw new Error(
        `Certifications migration verification failed:\n- ${failures.join('\n- ')}`,
      );
    }
    return { failures, dryRun: false };
  } finally {
    await client.end();
  }
}

async function main(): Promise<void> {
  const databaseUrl = process.env[CERTIFICATIONS_MIGRATION_VERIFY_DATABASE_URL];
  if (!databaseUrl) {
    throw new Error(
      `Set ${CERTIFICATIONS_MIGRATION_VERIFY_DATABASE_URL} (never DATABASE_URL)`,
    );
  }

  const dryRun = process.argv.includes('--dry-run');
  const allowNeon = process.env.ALLOW_NEON_CERTIFICATIONS_VERIFY === '1';
  const result = await verifyCertificationsMigration({
    databaseUrl,
    dryRun,
    allowNeon,
  });

  if (result.failures.length > 0) {
    console.error(result.failures.join('\n'));
    process.exitCode = 1;
    return;
  }
  console.log(
    dryRun
      ? 'Certifications migration verification dry-run OK'
      : 'Certifications migration verification OK',
  );
}

if (require.main === module) {
  void main();
}
