/**
 * Read-only report of certificate-import leftovers.
 *
 * Ignores DATABASE_URL. Reads SACDIA_AUDIT_DATABASE_URL, otherwise
 * SACDIA_TEST_DATABASE_URL. Accepts only a loopback host and a database
 * name ending in `_test`. `--apply` is refused: this file does not write,
 * promote FIELD_APPROVED rows, or merge Guía Mayor enrollments.
 */
import { Client } from 'pg';

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

if (process.argv.includes('--apply')) {
  fail(
    'APPLY_REFUSED: writes need a later explicit instruction, a backup, and a dry-run. This script only reports.',
  );
}

const url = (
  process.env.SACDIA_AUDIT_DATABASE_URL ||
  process.env.SACDIA_TEST_DATABASE_URL ||
  ''
).trim();

if (!url) {
  fail(
    'Set SACDIA_TEST_DATABASE_URL or SACDIA_AUDIT_DATABASE_URL. DATABASE_URL is ignored.',
  );
}

let parsed: URL;
try {
  parsed = new URL(url);
} catch {
  fail('REFUSED: database URL is not valid.');
}

const host = parsed.hostname;
const loopback = host === '127.0.0.1' || host === 'localhost' || host === '::1';
const name = decodeURIComponent(parsed.pathname.replace(/^\//, ''));
if (!loopback || !name.endsWith('_test')) {
  fail('REFUSED: only a loopback database whose name ends with _test.');
}

async function main() {
  const client = new Client({ connectionString: url });
  await client.connect();
  try {
    const files = await client.query<{ file_id: string; reason: string }>(`
      SELECT file_id::text,
        CASE
          WHEN object_key IS NULL OR btrim(object_key) = '' THEN 'MISSING_OBJECT'
          WHEN object_key ILIKE 'http%' THEN 'HTTP_OBJECT_KEY'
          WHEN file_url ILIKE 'file:%'
            OR file_url LIKE '/%'
            OR file_url ~ '^[A-Za-z]:\\\\' THEN 'LOCAL_PATH'
          ELSE 'INCOMPLETE'
        END AS reason
      FROM certificate_bulk_import_files
      WHERE active = true
        AND (
          object_key IS NULL
          OR btrim(object_key) = ''
          OR object_key ILIKE 'http%'
          OR upload_status IS DISTINCT FROM 'CONFIRMED'
          OR file_url ILIKE 'file:%'
          OR file_url LIKE '/%'
          OR file_url ~ '^[A-Za-z]:\\\\'
        )
      ORDER BY file_id
    `);

    const emptyBatches = await client.query<{ batch_id: string }>(`
      SELECT b.batch_id::text
      FROM certificate_bulk_import_batches b
      WHERE b.active = true
        AND NOT EXISTS (
          SELECT 1
          FROM certificate_bulk_import_files f
          WHERE f.batch_id = b.batch_id
            AND f.active = true
            AND f.upload_status = 'CONFIRMED'
            AND f.object_key IS NOT NULL
            AND btrim(f.object_key) <> ''
            AND f.object_key NOT ILIKE 'http%'
        )
      ORDER BY b.batch_id
    `);

    const fieldApproved = await client.query<{ enrollment_id: string }>(`
      SELECT enrollment_id::text
      FROM enrollments
      WHERE active = true
        AND record_kind = 'HISTORICAL_CERTIFICATE'
        AND investiture_status = 'FIELD_APPROVED'
      ORDER BY enrollment_id
    `);

    const duplicateGuideMajor = await client.query<{
      user_id: string;
      rows: string;
    }>(`
      SELECT e.user_id::text, COUNT(*)::text AS rows
      FROM enrollments e
      JOIN classes c ON c.class_id = e.class_id
      WHERE e.active = true
        AND c.asset_code = 'GM-01'
      GROUP BY e.user_id
      HAVING COUNT(*) > 1
      ORDER BY e.user_id
    `);

    const report = {
      dry_run: true,
      writes: false,
      files: files.rows,
      empty_batches: emptyBatches.rows.map((row) => row.batch_id),
      field_approved_historical: fieldApproved.rows.map(
        (row) => row.enrollment_id,
      ),
      duplicate_guide_major: duplicateGuideMajor.rows,
    };
    console.log(JSON.stringify(report, null, 2));
  } finally {
    await client.end();
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : 'audit failed';
  fail(message);
});
