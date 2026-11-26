/**
 * cleanup-orphan-honor-assets.ts
 *
 * Finds honor images and material PDFs uploaded from the admin
 * (`POST /admin/honors-catalog/assets`) that no honor references, and
 * optionally deletes them. Uploading and saving the honor are separate steps,
 * so a file uploaded from a form that was never saved stays in the bucket.
 *
 * Only objects under `admin-uploads/` in the HONORS_IMAGES and HONORS_PDF
 * buckets are candidates. A candidate is an orphan when no honor (active or
 * not) has its URL in `honor_image` or `material_url`, and it is older than
 * a day (the form that will save it may still be open).
 *
 * HOW TO RUN
 * ----------
 * Dry-run (default; lists orphans, deletes nothing):
 *   npx tsx scripts/cleanup-orphan-honor-assets.ts
 *
 * Apply mode (deletes the orphans listed by the dry-run):
 *   npx tsx scripts/cleanup-orphan-honor-assets.ts --apply
 *
 * NOTES
 * -----
 * - Needs DATABASE_URL and the R2 variables of both honors buckets (.env).
 * - In production, also set ALLOW_ORPHAN_CLEANUP_PROD=true or the script aborts.
 * - Deleting from R2 cannot be undone. Run the dry-run first.
 */

import 'dotenv/config';

import { ConfigService } from '@nestjs/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';
import pg from 'pg';

import {
  findOrphanHonorAssets,
  HONOR_ASSET_ORPHAN_MIN_AGE_MS,
  HONOR_ASSET_UPLOAD_PREFIX,
  type StoredObject,
} from '../src/admin/honor-asset-orphans';
import { StorageBucketAlias } from '../src/common/services/file-storage.service';
import { R2FileStorageService } from '../src/common/services/r2-file-storage.service';

const APPLY_FLAG = '--apply';
const DELETE_BATCH_SIZE = 1000;
const SAMPLE_COUNT = 10;
const COUNTDOWN_SECONDS = 5;

const BUCKETS = [
  StorageBucketAlias.HONORS_IMAGES,
  StorageBucketAlias.HONORS_PDF,
] as const;

function getRequiredEnv(key: string): string {
  const value = process.env[key];
  if (!value) {
    console.error(`[FATAL] Missing required env var: ${key}`);
    process.exit(1);
  }
  return value;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function countdown(seconds: number): Promise<void> {
  return new Promise((resolve, reject) => {
    let remaining = seconds;
    console.log(`\n  Deleting in ${remaining}s. Ctrl+C to abort...`);
    const interval = setInterval(() => {
      remaining -= 1;
      if (remaining <= 0) {
        clearInterval(interval);
        resolve();
      } else {
        process.stdout.write(`  ${remaining}... `);
      }
    }, 1_000);
    process.once('SIGINT', () => {
      clearInterval(interval);
      console.log('\n\n[ABORTED] Nothing was deleted.');
      reject(new Error('SIGINT'));
    });
  });
}

async function main() {
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
  const now = new Date();
  const storage = new R2FileStorageService(new ConfigService(process.env));
  const pool = new pg.Pool({
    connectionString: getRequiredEnv('DATABASE_URL'),
  });
  const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

  console.log('='.repeat(60));
  console.log('  SACDIA: orphan honor asset cleanup');
  console.log('='.repeat(60));
  console.log(
    `  Mode        : ${applyMode ? 'APPLY (deletes from R2)' : 'DRY-RUN (read-only)'}`,
  );
  console.log(`  Environment : ${nodeEnv}`);
  console.log(`  Prefix      : ${HONOR_ASSET_UPLOAD_PREFIX}`);
  console.log(
    `  Min age     : ${HONOR_ASSET_ORPHAN_MIN_AGE_MS / (60 * 60 * 1000)} h`,
  );
  console.log('='.repeat(60) + '\n');

  try {
    // Every honor, active or not: a deactivated honor keeps its files.
    const honors = await prisma.honors.findMany({
      select: { honor_image: true, material_url: true },
    });
    const urls = honors.flatMap(({ honor_image, material_url }) => [
      honor_image,
      material_url,
    ]);

    const orphansByBucket = new Map<StorageBucketAlias, StoredObject[]>();
    for (const bucket of BUCKETS) {
      const referenced = new Set(
        urls
          .map((url) =>
            url ? storage.extractKeyFromPublicUrl(bucket, url) : null,
          )
          .filter((key): key is string => key !== null),
      );
      const objects = await storage.listObjects(
        bucket,
        HONOR_ASSET_UPLOAD_PREFIX,
      );
      const orphans = findOrphanHonorAssets(objects, referenced, now);
      orphansByBucket.set(bucket, orphans);

      const bytes = orphans.reduce((total, item) => total + item.size, 0);
      console.log(
        `[${bucket}] ${objects.length} uploads, ${orphans.length} orphans (${formatBytes(bytes)})`,
      );
      orphans.slice(0, SAMPLE_COUNT).forEach((item) => {
        console.log(
          `    - ${item.key} (${item.lastModified?.toISOString() ?? 'no date'}, ${formatBytes(item.size)})`,
        );
      });
      if (orphans.length > SAMPLE_COUNT) {
        console.log(`    ... and ${orphans.length - SAMPLE_COUNT} more`);
      }
    }

    const total = [...orphansByBucket.values()].reduce(
      (sum, orphans) => sum + orphans.length,
      0,
    );
    if (total === 0) {
      console.log('\nNo orphans found. Nothing to do.');
      return;
    }
    if (!applyMode) {
      console.log(
        `\nDRY-RUN: ${total} orphans found. Run with ${APPLY_FLAG} to delete them.`,
      );
      return;
    }

    await countdown(COUNTDOWN_SECONDS);
    for (const [bucket, orphans] of orphansByBucket) {
      for (let i = 0; i < orphans.length; i += DELETE_BATCH_SIZE) {
        const batch = orphans.slice(i, i + DELETE_BATCH_SIZE);
        await storage.deleteMany(
          bucket,
          batch.map((item) => item.key),
        );
      }
      console.log(`[${bucket}] deleted ${orphans.length} orphans`);
    }
    console.log(`\nDone: ${total} orphans deleted.`);
  } finally {
    await prisma.$disconnect();
    await pool.end();
  }
}

main().catch((error: unknown) => {
  if (error instanceof Error && error.message === 'SIGINT') {
    process.exit(130);
  }
  console.error('[FATAL]', error);
  process.exit(1);
});
