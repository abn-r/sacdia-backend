/**
 * encrypt-totp-secrets.ts
 *
 * Encrypts TOTP secrets stored in plaintext in `verifications`
 * (identifier `totp:{userId}`, value `{ secret, backupCodes }`) into the
 * `{ secretEnc, backupCodes }` shape, using TOTP_ENCRYPTION_KEY.
 *
 * Usage:
 *   pnpm mfa:encrypt-totp-secrets                # dry run: prints counts only
 *   pnpm mfa:encrypt-totp-secrets -- --apply     # writes (needs the key)
 *
 * Safety:
 * - Dry run is the default and writes nothing.
 * - Idempotent: rows that already have `secretEnc` are skipped.
 * - One transaction per row; the row is re-read inside it and only rewritten
 *   if it is still plaintext.
 * - Never prints secrets, the key, or full identifiers.
 */

import 'dotenv/config';

import {
  decodeTotpEncryptionKey,
  encryptTotpSecret,
} from '../src/common/crypto/totp-secret-cipher';

const IDENTIFIER_PREFIX = 'totp:';
const BATCH_SIZE = 200;

export type TotpRow = { id: string; identifier: string; value: string };

export type EncryptTotpResult = {
  scanned: number;
  plaintext: number;
  alreadyEncrypted: number;
  malformed: number;
  encrypted: number;
  failed: number;
};

type TxClient = {
  verification: {
    findUnique: (args: {
      where: { id: string };
      select: { identifier: true; value: true };
    }) => Promise<{ identifier: string; value: string } | null>;
    update: (args: {
      where: { id: string };
      data: { value: string; updatedAt: Date };
    }) => Promise<unknown>;
  };
};

export type EncryptTotpPrisma = {
  verification: {
    findMany: (args: {
      where: { identifier: { startsWith: string } };
      select: { id: true; identifier: true; value: true };
      orderBy: { id: 'asc' };
      take: number;
      cursor?: { id: string };
      skip?: number;
    }) => Promise<TotpRow[]>;
  };
  $transaction: <T>(fn: (tx: TxClient) => Promise<T>) => Promise<T>;
};

type RowKind = 'plaintext' | 'encrypted' | 'malformed';

function classify(value: string): RowKind {
  try {
    const raw: unknown = JSON.parse(value);
    if (!raw || typeof raw !== 'object') return 'malformed';
    const obj = raw as Record<string, unknown>;
    if (typeof obj.secretEnc === 'string') return 'encrypted';
    if (typeof obj.secret === 'string' && obj.secret.length > 0) {
      return 'plaintext';
    }
  } catch {
    // falls through
  }
  return 'malformed';
}

/** Returns the encrypted value for a plaintext row, or null if not plaintext. */
function encryptValue(
  identifier: string,
  value: string,
  key: Buffer,
): string | null {
  if (classify(value) !== 'plaintext') return null;
  const obj = JSON.parse(value) as { secret: string; backupCodes?: unknown };
  return JSON.stringify({
    secretEnc: encryptTotpSecret(obj.secret, identifier, key),
    backupCodes: Array.isArray(obj.backupCodes) ? obj.backupCodes : [],
  });
}

export async function encryptTotpSecrets(
  prisma: EncryptTotpPrisma,
  options: { apply: boolean; key: Buffer | null },
): Promise<EncryptTotpResult> {
  if (options.apply && !options.key) {
    throw new Error('TOTP_ENCRYPTION_KEY is required with --apply');
  }
  const result: EncryptTotpResult = {
    scanned: 0,
    plaintext: 0,
    alreadyEncrypted: 0,
    malformed: 0,
    encrypted: 0,
    failed: 0,
  };

  let cursor: string | undefined;
  for (;;) {
    const rows = await prisma.verification.findMany({
      where: { identifier: { startsWith: IDENTIFIER_PREFIX } },
      select: { id: true, identifier: true, value: true },
      orderBy: { id: 'asc' },
      take: BATCH_SIZE,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });
    if (rows.length === 0) break;
    cursor = rows[rows.length - 1].id;

    for (const row of rows) {
      result.scanned += 1;
      const kind = classify(row.value);
      if (kind === 'encrypted') {
        result.alreadyEncrypted += 1;
        continue;
      }
      if (kind === 'malformed') {
        result.malformed += 1;
        continue;
      }
      result.plaintext += 1;
      if (!options.apply || !options.key) continue;

      const key = options.key;
      try {
        const written = await prisma.$transaction(async (tx) => {
          const fresh = await tx.verification.findUnique({
            where: { id: row.id },
            select: { identifier: true, value: true },
          });
          if (!fresh) return false;
          const next = encryptValue(fresh.identifier, fresh.value, key);
          if (!next) return false;
          await tx.verification.update({
            where: { id: row.id },
            data: { value: next, updatedAt: new Date() },
          });
          return true;
        });
        if (written) result.encrypted += 1;
      } catch {
        result.failed += 1;
      }
    }
    if (rows.length < BATCH_SIZE) break;
  }
  return result;
}

export function parseArgs(args: string[]): { apply: boolean } {
  let apply = false;
  for (const arg of args) {
    if (arg === '--apply') apply = true;
    else if (arg !== '--dry-run' && arg !== '--') {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return { apply };
}

async function main(): Promise<void> {
  const { apply } = parseArgs(process.argv.slice(2));
  const rawKey = process.env.TOTP_ENCRYPTION_KEY;
  const key = rawKey ? decodeTotpEncryptionKey(rawKey) : null;
  if (rawKey && !key) {
    throw new Error('TOTP_ENCRYPTION_KEY must be base64 of exactly 32 bytes');
  }
  if (apply && !key) {
    throw new Error('TOTP_ENCRYPTION_KEY is required with --apply');
  }
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error('DATABASE_URL is required');

  const { PrismaClient } = await import('@prisma/client');
  const { PrismaPg } = await import('@prisma/adapter-pg');
  const pg = (await import('pg')).default;
  const pool = new pg.Pool({ connectionString: databaseUrl });
  const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

  console.log(`Mode: ${apply ? 'APPLY (writes)' : 'DRY RUN (no writes)'}`);
  try {
    const result = await encryptTotpSecrets(prisma, { apply, key });
    console.log(`Scanned TOTP rows     : ${result.scanned}`);
    console.log(`Plaintext             : ${result.plaintext}`);
    console.log(`Already encrypted     : ${result.alreadyEncrypted}`);
    console.log(`Malformed (untouched) : ${result.malformed}`);
    console.log(`Encrypted now         : ${result.encrypted}`);
    console.log(`Failed                : ${result.failed}`);
    if (!apply && result.plaintext > 0) {
      console.log('Re-run with --apply to encrypt the plaintext rows.');
    }
    if (result.failed > 0) process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
    await pool.end();
  }
}

if (process.argv[1]?.includes('encrypt-totp-secrets')) {
  main().catch((error: unknown) => {
    console.error(
      `encrypt-totp-secrets aborted: ${error instanceof Error ? error.message : 'unknown_error'}`,
    );
    process.exitCode = 1;
  });
}
