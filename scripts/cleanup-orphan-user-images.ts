/**
 * cleanup-orphan-user-images.ts
 *
 * One-shot script to detect and optionally null-out `users.user_image` rows
 * that point to files no longer present in the Cloudflare R2 public bucket
 * (USER_PROFILES), following the migration from private signed URLs to public CDN.
 *
 * HOW TO RUN
 * ----------
 * Dry-run (default — safe, no DB writes):
 *   npx tsx scripts/cleanup-orphan-user-images.ts
 *
 * Apply mode (nulls MISSING rows in a single transaction):
 *   npx tsx scripts/cleanup-orphan-user-images.ts --apply
 *
 * NOTES
 * -----
 * - Requires DATABASE_URL and R2_PUBLIC_URL_USER_PROFILES in env (loaded from .env).
 * - In production, also set ALLOW_ORPHAN_CLEANUP_PROD=true or the script aborts.
 * - ERROR class (timeout / 5xx / network) is NEVER nulled — logged for manual review.
 * - Writes full audit log to orphan-cleanup-{timestamp}.json in the project root.
 */

import 'dotenv/config';

import { writeFile } from 'node:fs/promises';
import { createInterface } from 'node:readline';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import pg from 'pg';
import pLimit from 'p-limit';

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const CONCURRENCY = 20;
const FETCH_TIMEOUT_MS = 5_000;
const APPLY_FLAG = '--apply';
const SAMPLE_COUNT = 5;

type Status = 'OK' | 'MISSING' | 'ERROR';

interface Row {
  user_id: string;
  user_image: string;
}

interface AuditEntry {
  user_id: string;
  user_image: string;
  status: Status;
  status_code: number | null;
  error?: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getRequiredEnv(key: string): string {
  const val = process.env[key];
  if (!val) {
    console.error(`[FATAL] Missing required env var: ${key}`);
    process.exit(1);
  }
  return val;
}

function normalizeBaseUrl(url: string): string {
  return url.trim().replace(/\/+$/, '');
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
    return null; // timeout or network error
  } finally {
    clearTimeout(timer);
  }
}

function classifyStatus(statusCode: number | null): Status {
  if (statusCode === 200) return 'OK';
  if (statusCode === 404) return 'MISSING';
  return 'ERROR';
}

function printSamples(label: string, entries: AuditEntry[]): void {
  if (entries.length === 0) return;
  console.log(`  First ${Math.min(SAMPLE_COUNT, entries.length)} ${label}:`);
  entries.slice(0, SAMPLE_COUNT).forEach((e) => {
    const detail = e.error ? ` (${e.error})` : ` (HTTP ${e.status_code ?? 'no-response'})`;
    console.log(`    - ${e.user_id} → ${e.user_image}${detail}`);
  });
}

async function countdown(seconds: number): Promise<void> {
  return new Promise((resolve, reject) => {
    let remaining = seconds;
    console.log(`\n  Applying in ${remaining}s — Ctrl+C to abort...`);
    const interval = setInterval(() => {
      remaining -= 1;
      if (remaining <= 0) {
        clearInterval(interval);
        resolve();
      } else {
        process.stdout.write(`  ${remaining}... `);
      }
    }, 1_000);

    // Reject immediately if user hits Ctrl+C
    process.once('SIGINT', () => {
      clearInterval(interval);
      console.log('\n\n[ABORTED] No changes were made.');
      reject(new Error('SIGINT'));
    });
  });
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  // --- Safety: block production without explicit opt-in ---
  const nodeEnv = process.env.NODE_ENV ?? 'development';
  if (
    nodeEnv === 'production' &&
    process.env.ALLOW_ORPHAN_CLEANUP_PROD !== 'true'
  ) {
    console.error(
      '[FATAL] Running in production is blocked.\n' +
        '  Set ALLOW_ORPHAN_CLEANUP_PROD=true to override.',
    );
    process.exit(1);
  }

  const applyMode = process.argv.includes(APPLY_FLAG);
  const publicBaseUrl = normalizeBaseUrl(
    getRequiredEnv('R2_PUBLIC_URL_USER_PROFILES'),
  );
  const databaseUrl = getRequiredEnv('DATABASE_URL');

  console.log('='.repeat(60));
  console.log('  SACDIA — Orphan user_image cleanup');
  console.log('='.repeat(60));
  console.log(`  Mode         : ${applyMode ? 'APPLY (will write to DB)' : 'DRY-RUN (read-only)'}`);
  console.log(`  Environment  : ${nodeEnv}`);
  console.log(`  Public CDN   : ${publicBaseUrl}`);
  console.log(`  Concurrency  : ${CONCURRENCY}`);
  console.log(`  HEAD timeout : ${FETCH_TIMEOUT_MS}ms`);
  console.log('='.repeat(60) + '\n');

  // --- DB setup ---
  const pool = new pg.Pool({ connectionString: databaseUrl });
  const adapter = new PrismaPg(pool);
  const prisma = new PrismaClient({ adapter });

  try {
    // --- 1. Read all rows with a non-null user_image ---
    console.log('[1/4] Querying users with user_image IS NOT NULL...');
    const rows = await prisma.users.findMany({
      where: { user_image: { not: null } },
      select: { user_id: true, user_image: true },
    });

    const total = rows.length;
    console.log(`      Found ${total} rows to check.\n`);

    if (total === 0) {
      console.log('[DONE] Nothing to do. No rows with user_image set.');
      return;
    }

    // --- 2. HEAD each URL with bounded concurrency ---
    console.log(`[2/4] Performing HEAD requests (concurrency=${CONCURRENCY})...`);

    const limit = pLimit(CONCURRENCY);
    const audit: AuditEntry[] = [];
    let done = 0;

    const tasks = (rows as Row[]).map((row) =>
      limit(async () => {
        const url = row.user_image;
        const statusCode = await headWithTimeout(url);
        const status = classifyStatus(statusCode);
        const entry: AuditEntry = {
          user_id: row.user_id,
          user_image: url,
          status,
          status_code: statusCode,
          ...(status === 'ERROR' && !statusCode
            ? { error: 'timeout/network' }
            : {}),
        };
        audit.push(entry);
        done += 1;
        if (done % 50 === 0 || done === total) {
          process.stdout.write(`\r      Progress: ${done}/${total}`);
        }
        return entry;
      }),
    );

    await Promise.all(tasks);
    console.log('\n');

    // --- 3. Classify ---
    const ok = audit.filter((e) => e.status === 'OK');
    const missing = audit.filter((e) => e.status === 'MISSING');
    const errors = audit.filter((e) => e.status === 'ERROR');

    console.log('[3/4] Results summary:');
    console.log(`      Total scanned : ${total}`);
    console.log(`      OK (200)      : ${ok.length} (${pct(ok.length, total)}%)`);
    console.log(`      MISSING (404) : ${missing.length} (${pct(missing.length, total)}%)`);
    console.log(`      ERROR         : ${errors.length} (${pct(errors.length, total)}%)`);
    console.log('');

    if (missing.length > 0) {
      printSamples('MISSING user_ids', missing);
      console.log('');
    }
    if (errors.length > 0) {
      printSamples('ERROR user_ids (skipped — not nulled)', errors);
      console.log('');
    }

    // --- 4. Write audit log ---
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const auditFile = `orphan-cleanup-${timestamp}.json`;
    const auditPayload = {
      generatedAt: new Date().toISOString(),
      mode: applyMode ? 'apply' : 'dry-run',
      environment: nodeEnv,
      publicBaseUrl,
      summary: {
        total,
        ok: ok.length,
        missing: missing.length,
        errors: errors.length,
      },
      entries: audit,
    };

    await writeFile(auditFile, JSON.stringify(auditPayload, null, 2), 'utf8');
    console.log(`[4/4] Audit log written to: ${auditFile}\n`);

    // --- 5. Apply if requested ---
    if (!applyMode) {
      console.log('[DRY-RUN] No DB changes made. Re-run with --apply to null out MISSING rows.');
      return;
    }

    if (missing.length === 0) {
      console.log('[APPLY] No MISSING rows found — nothing to update.');
      return;
    }

    console.log(`[APPLY] About to SET user_image = NULL for ${missing.length} rows.`);

    try {
      await countdown(5);
    } catch {
      // SIGINT was caught inside countdown — exit gracefully
      process.exit(0);
    }

    const missingIds = missing.map((e) => e.user_id);

    console.log('\n[APPLY] Writing to database...');
    const result = await prisma.$transaction(async (tx) => {
      // Prisma does not support updateMany with a list of IDs directly returning count
      // in all adapters, so we use a single updateMany with `in` filter.
      const updated = await tx.users.updateMany({
        where: { user_id: { in: missingIds } },
        data: { user_image: null },
      });
      return updated.count;
    });

    console.log(`\n[DONE] Updated ${result} rows (SET user_image = NULL).`);

    if (errors.length > 0) {
      console.log(
        `\n[WARN] ${errors.length} rows were skipped (ERROR class — transient or unknown).\n` +
          `       Review the audit log for manual action: ${auditFile}`,
      );
    }
  } finally {
    await prisma.$disconnect();
    await pool.end();
  }
}

function pct(part: number, total: number): string {
  if (total === 0) return '0.0';
  return ((part / total) * 100).toFixed(1);
}

main().catch((err) => {
  if (err instanceof Error && err.message === 'SIGINT') {
    process.exit(0);
  }
  console.error('\n[FATAL]', err instanceof Error ? err.message : err);
  process.exit(1);
});
