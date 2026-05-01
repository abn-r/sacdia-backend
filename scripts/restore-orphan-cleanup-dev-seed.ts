/**
 * restore-orphan-cleanup-dev-seed.ts
 *
 * One-shot recovery for the dev seed user_image rows that were incorrectly
 * nulled by cleanup-orphan-user-images.ts on 2026-04-23.
 *
 * ROOT CAUSE
 * ----------
 * Bug #1 in R2FileStorageService.upload() returned URLs WITHOUT the keyPrefix
 * (e.g. `.r2.dev/photo-xxx.jpeg` instead of `.r2.dev/user-profiles/photo-xxx.jpeg`).
 * The cleanup script HEAD-checked those broken URLs, received 404, classified
 * them as MISSING, and nulled the rows. The actual files exist in R2 under the
 * WITH-prefix path and are intact.
 *
 * WHAT THIS SCRIPT DOES
 * ---------------------
 * 1. Reads the two audit log JSON files produced by the cleanup runs:
 *      orphan-cleanup-2026-04-23T22-41-27-283Z.json  (9 MISSING + 2 ERROR)
 *      orphan-cleanup-2026-04-23T22-41-41-737Z.json  (2 MISSING — the ERRORs retried)
 * 2. Collects all entries classified as MISSING.
 * 3. Reconstructs the corrected URL by inserting the keyPrefix segment
 *    (user-profiles/) between the CDN base and the filename.
 * 4. HEAD-checks the corrected URL:
 *      200 → eligible to restore
 *      anything else → skip (genuine orphan or network error)
 * 5. Skips user 104a2549-2056-4b9b-aaeb-51d8fd43191d (manually restored).
 * 6. Dry-run by default — pass --apply to write to DB.
 *
 * SAFETY GUARDS
 * -------------
 * - Refuses to run unless NODE_ENV=development.
 * - Never writes unless --apply is passed.
 * - Skips entries whose corrected URL HEAD returns non-200.
 *
 * HOW TO RUN
 * ----------
 * Dry-run (safe, default):
 *   npx tsx scripts/restore-orphan-cleanup-dev-seed.ts
 *
 * Apply (writes to DB):
 *   npx tsx scripts/restore-orphan-cleanup-dev-seed.ts --apply
 */

import 'dotenv/config';

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import pg from 'pg';

// ---------------------------------------------------------------------------
// Types (mirror the shape produced by cleanup-orphan-user-images.ts)
// ---------------------------------------------------------------------------

type AuditStatus = 'OK' | 'MISSING' | 'ERROR';

interface AuditEntry {
  user_id: string;
  user_image: string;
  status: AuditStatus;
  status_code: number | null;
  error?: string;
}

interface AuditLog {
  generatedAt: string;
  mode: string;
  environment: string;
  publicBaseUrl: string;
  summary: {
    total: number;
    ok: number;
    missing: number;
    errors: number;
  };
  entries: AuditEntry[];
}

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const APPLY_FLAG = '--apply';
const FETCH_TIMEOUT_MS = 8_000;
const CONCURRENCY = 10;

// User already manually restored — skip unconditionally.
const MANUALLY_RESTORED_USER_ID = '104a2549-2056-4b9b-aaeb-51d8fd43191d';

// The two audit log files produced by the 2026-04-23 cleanup runs.
// Both are gitignored and live in the project root.
const AUDIT_FILES = [
  'orphan-cleanup-2026-04-23T22-41-27-283Z.json',
  'orphan-cleanup-2026-04-23T22-41-41-737Z.json',
];

// The key prefix that was missing from the broken URLs.
// Matches R2_KEY_PREFIX_USER_PROFILES in .env.
const KEY_PREFIX = 'user-profiles';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createLimiter(concurrency: number) {
  let active = 0;
  const queue: Array<() => void> = [];
  const next = () => {
    active--;
    const fn = queue.shift();
    if (fn) fn();
  };
  return <T>(task: () => Promise<T>): Promise<T> =>
    new Promise<T>((resolve, reject) => {
      const run = () => {
        active++;
        task().then(
          (v) => {
            resolve(v);
            next();
          },
          (e) => {
            reject(e);
            next();
          },
        );
      };
      if (active < concurrency) run();
      else queue.push(run);
    });
}

async function headWithTimeout(url: string): Promise<number | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: 'HEAD',
      signal: controller.signal,
    });
    return res.status;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Given a broken URL like:
 *   https://pub-xxx.r2.dev/photo-abc.jpeg
 * Returns the corrected URL with the keyPrefix inserted:
 *   https://pub-xxx.r2.dev/user-profiles/photo-abc.jpeg
 *
 * Handles two shapes:
 *   - Already has prefix → return as-is (idempotent)
 *   - Has no prefix → insert KEY_PREFIX before the filename
 */
function buildCorrectedUrl(brokenUrl: string): string {
  try {
    const parsed = new URL(brokenUrl);
    const rawPath = parsed.pathname.replace(/^\/+/, '');

    // Already prefixed — was this a correctly-formed URL? Return as-is.
    if (rawPath.startsWith(`${KEY_PREFIX}/`)) {
      return brokenUrl;
    }

    // Insert the prefix between origin and the existing path segment.
    parsed.pathname = `/${KEY_PREFIX}/${rawPath}`;
    return parsed.toString();
  } catch {
    // Non-parseable URL — return unchanged so caller can HEAD-check and skip
    return brokenUrl;
  }
}

function getRequiredEnv(key: string): string {
  const val = process.env[key];
  if (!val) {
    console.error(`[FATAL] Missing required env var: ${key}`);
    process.exit(1);
  }
  return val;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  // Safety: block non-dev environments unconditionally.
  const nodeEnv = (process.env.NODE_ENV ?? 'development').toLowerCase();
  if (nodeEnv !== 'development') {
    console.error(
      `[FATAL] This script is restricted to NODE_ENV=development.\n` +
        `        Current NODE_ENV="${nodeEnv}". Aborting.`,
    );
    process.exit(1);
  }

  const applyMode = process.argv.includes(APPLY_FLAG);

  console.log('='.repeat(64));
  console.log('  SACDIA — Restore orphan-cleanup dev seed (2026-04-23)');
  console.log('='.repeat(64));
  console.log(`  Mode        : ${applyMode ? 'APPLY (writes to DB)' : 'DRY-RUN (no writes)'}`);
  console.log(`  Environment : ${nodeEnv}`);
  console.log(`  Key prefix  : ${KEY_PREFIX}`);
  console.log('='.repeat(64) + '\n');

  // --- 1. Read and merge audit logs ---
  console.log('[1/4] Reading audit log files...');

  // The cleanup script writes audit logs to the process working directory
  // (the project root), so we resolve relative to cwd — same convention.
  const projectRoot = process.cwd();

  const allMissingEntries = new Map<string, AuditEntry>();

  for (const filename of AUDIT_FILES) {
    const filePath = path.join(projectRoot, filename);
    let raw: string;
    try {
      raw = await readFile(filePath, 'utf8');
    } catch (err) {
      console.error(`  [WARN] Could not read ${filename}: ${String(err)}`);
      console.error(
        `         Make sure the file exists in the project root and try again.`,
      );
      process.exit(1);
    }

    const log = JSON.parse(raw) as AuditLog;
    const missingInFile = log.entries.filter((e) => e.status === 'MISSING');
    console.log(
      `  ${filename}: ${log.entries.length} total, ${missingInFile.length} MISSING`,
    );

    for (const entry of missingInFile) {
      // Deduplicate by user_id (second pass re-processes the same users)
      if (!allMissingEntries.has(entry.user_id)) {
        allMissingEntries.set(entry.user_id, entry);
      }
    }
  }

  console.log(
    `\n  Unique MISSING user_ids found: ${allMissingEntries.size}`,
  );

  // --- 2. Filter — skip manually-restored user ---
  if (allMissingEntries.has(MANUALLY_RESTORED_USER_ID)) {
    allMissingEntries.delete(MANUALLY_RESTORED_USER_ID);
    console.log(
      `  Skipped ${MANUALLY_RESTORED_USER_ID} (already restored manually)`,
    );
  }

  if (allMissingEntries.size === 0) {
    console.log('\n[DONE] No entries to recover.');
    return;
  }

  // --- 3. Reconstruct corrected URLs and HEAD-check ---
  console.log(
    `\n[2/4] Reconstructing corrected URLs and HEAD-checking (concurrency=${CONCURRENCY})...`,
  );

  type RecoveryEntry = {
    user_id: string;
    broken_url: string;
    corrected_url: string;
    head_status: number | null;
    restorable: boolean;
  };

  const limit = createLimiter(CONCURRENCY);
  const recoveries: RecoveryEntry[] = [];
  let checked = 0;

  const tasks = Array.from(allMissingEntries.values()).map((entry) =>
    limit(async () => {
      const correctedUrl = buildCorrectedUrl(entry.user_image);
      const headStatus = await headWithTimeout(correctedUrl);
      const restorable = headStatus === 200;

      const rec: RecoveryEntry = {
        user_id: entry.user_id,
        broken_url: entry.user_image,
        corrected_url: correctedUrl,
        head_status: headStatus,
        restorable,
      };
      recoveries.push(rec);
      checked++;
      process.stdout.write(`\r      Checked: ${checked}/${allMissingEntries.size}`);
      return rec;
    }),
  );

  await Promise.all(tasks);
  console.log('\n');

  const restorable = recoveries.filter((r) => r.restorable);
  const notRestorable = recoveries.filter((r) => !r.restorable);

  // --- 4. Summary ---
  console.log('[3/4] HEAD-check results:');
  console.log(`      Checked      : ${recoveries.length}`);
  console.log(`      Restorable   : ${restorable.length} (HTTP 200)`);
  console.log(`      Not restorable: ${notRestorable.length} (non-200 or timeout)`);

  if (restorable.length > 0) {
    console.log('\n  Restorable entries:');
    for (const r of restorable) {
      console.log(`    [${r.user_id}]`);
      console.log(`      broken  : ${r.broken_url}`);
      console.log(`      restored: ${r.corrected_url}`);
    }
  }

  if (notRestorable.length > 0) {
    console.log('\n  NOT restorable (will remain NULL):');
    for (const r of notRestorable) {
      const reason =
        r.head_status !== null ? `HTTP ${r.head_status}` : 'timeout/network';
      console.log(`    [${r.user_id}] ${reason} — ${r.corrected_url}`);
    }
  }

  if (!applyMode) {
    console.log(
      '\n[DRY-RUN] No DB changes made.\n' +
        '         Re-run with --apply to write restored URLs.',
    );
    return;
  }

  if (restorable.length === 0) {
    console.log('\n[APPLY] Nothing to restore — all corrected URLs returned non-200.');
    return;
  }

  // --- 5. Apply ---
  console.log(`\n[4/4] Applying — restoring ${restorable.length} row(s)...`);

  const databaseUrl = getRequiredEnv('DATABASE_URL');
  const pool = new pg.Pool({ connectionString: databaseUrl });
  const adapter = new PrismaPg(pool);
  const prisma = new PrismaClient({ adapter });

  let restored = 0;
  let failed = 0;

  try {
    for (const r of restorable) {
      try {
        await prisma.users.update({
          where: { user_id: r.user_id },
          data: { user_image: r.corrected_url },
        });
        restored++;
        console.log(`  [OK] ${r.user_id} → ${r.corrected_url}`);
      } catch (err) {
        failed++;
        console.error(
          `  [ERR] Failed to restore ${r.user_id}: ${String(err)}`,
        );
      }
    }
  } finally {
    await prisma.$disconnect();
    await pool.end();
  }

  console.log(`\n[DONE] Restored: ${restored} | Failed: ${failed}`);

  if (failed > 0) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('\n[FATAL]', err instanceof Error ? err.message : String(err));
  process.exit(1);
});
