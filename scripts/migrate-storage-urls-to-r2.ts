import 'dotenv/config';
import { Prisma, PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';

type MigrationTable =
  | 'users'
  | 'activities'
  | 'honors'
  | 'classes'
  | 'users_honors';

type MigrationSample = {
  id: string;
  field: string;
  before: string;
  after: string;
};

type MigrationResult = {
  table: MigrationTable;
  scanned: number;
  changed: number;
  applied: number;
  errors: number;
  samples: MigrationSample[];
};

type StorageTarget = {
  name: string;
  bucket: string;
  publicBaseUrl: string;
  keyPrefix: string;
  legacyPrefixes: string[];
};

type MigrateOptions = {
  apply: boolean;
  limit?: number;
  onlyTables: Set<MigrationTable>;
};

const SAMPLE_LIMIT_PER_TABLE = 5;
const ALL_TABLES: MigrationTable[] = [
  'users',
  'activities',
  'honors',
  'classes',
  'users_honors',
];

function getArg(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  if (index === -1) return undefined;
  return process.argv[index + 1];
}

function hasFlag(flag: string): boolean {
  return process.argv.includes(flag);
}

function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.trim().replace(/\/+$/, '');
}

function normalizePath(value: string): string {
  return value.trim().replace(/^\/+/, '').replace(/\/+$/, '');
}

function normalizePrefix(prefix: string): string {
  return prefix.trim().replace(/^\/+|\/+$/g, '');
}

function looksLikeUrl(value: string): boolean {
  return /^https?:\/\//i.test(value);
}

function hasControlCharacters(value: string): boolean {
  return /[\u0000-\u001F\u007F]/.test(value);
}

function isLikelyLocalFilePath(value: string): boolean {
  const normalized = value.trim();
  if (!normalized) return false;

  if (/^file:\/\//i.test(normalized)) return true;
  if (/^[A-Za-z]:[\\/]/.test(normalized)) return true;
  if (normalized.startsWith('/')) return true;

  return false;
}

function allowBareKeyForLiteralValue(value: string): boolean {
  const normalized = value.trim();
  if (!normalized) return false;
  if (normalized.includes('/')) return true;
  if (normalized.includes('.')) return true;
  return false;
}

function parseUrl(value: string): URL | null {
  try {
    return new URL(value);
  } catch {
    return null;
  }
}

function buildPublicUrl(
  target: Pick<StorageTarget, 'publicBaseUrl' | 'keyPrefix'>,
  relativeKey: string,
): string {
  const normalizedBase = normalizeBaseUrl(target.publicBaseUrl);
  const normalizedKey = normalizePath(relativeKey)
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/');
  const prefix = normalizePrefix(target.keyPrefix);

  // Only inject the keyPrefix when it is NOT already embedded in publicBaseUrl.
  // Some buckets encode the prefix in the base URL (e.g. "…/honors") while
  // others expose a bare domain (e.g. "https://pub-xxx.r2.dev") and rely on
  // the prefix being prepended here.  Detecting this prevents double-prefix
  // paths like ".../honors/honors/image.png".
  const basePath = getConfiguredBasePath(normalizedBase);
  const prefixAlreadyInBase =
    prefix !== '' &&
    (basePath === prefix ||
      basePath.endsWith(`/${prefix}`) ||
      basePath.startsWith(`${prefix}/`));

  const path =
    prefix && !prefixAlreadyInBase ? `${prefix}/${normalizedKey}` : normalizedKey;
  return `${normalizedBase}/${path}`;
}

function getConfiguredHost(publicBaseUrl: string): string | null {
  const parsed = parseUrl(publicBaseUrl);
  return parsed ? parsed.hostname.toLowerCase() : null;
}

function getConfiguredBasePath(publicBaseUrl: string): string {
  const parsed = parseUrl(publicBaseUrl);
  if (!parsed) return '';
  return normalizePath(decodeURIComponent(parsed.pathname));
}

function isKnownStorageHost(url: URL, target: StorageTarget): boolean {
  const host = url.hostname.toLowerCase();
  const configuredHost = getConfiguredHost(target.publicBaseUrl);

  if (configuredHost && host === configuredHost) return true;
  if (host.endsWith('.supabase.co')) return true;
  if (host.endsWith('.r2.dev')) return true;
  if (host.endsWith('.r2.cloudflarestorage.com')) return true;

  return false;
}

function extractSupabaseStoragePath(
  urlPath: string,
): { bucket: string; key: string } | null {
  const match = urlPath.match(
    /(?:^|\/)storage\/v1\/object\/(?:public|sign)\/([^/]+)\/(.+)$/i,
  );
  if (!match) return null;
  return {
    bucket: match[1],
    key: normalizePath(match[2]),
  };
}

function extractRelativePathFromConfiguredBase(
  urlPath: string,
  target: StorageTarget,
): string | null {
  const basePath = getConfiguredBasePath(target.publicBaseUrl);
  if (!basePath) return null;

  if (urlPath === basePath) return null;
  if (urlPath.startsWith(`${basePath}/`)) {
    return normalizePath(urlPath.slice(basePath.length + 1));
  }
  return null;
}

function deriveRelativeKey(
  candidate: string,
  target: StorageTarget,
  allowBareKey: boolean,
): string | null {
  let key = normalizePath(candidate);
  if (!key) return null;

  const normalizedBucket = normalizePrefix(target.bucket);
  if (normalizedBucket && key.startsWith(`${normalizedBucket}/`)) {
    key = normalizePath(key.slice(normalizedBucket.length + 1));
  }

  const allPrefixes = [
    target.keyPrefix,
    ...target.legacyPrefixes,
  ].map(normalizePrefix);
  const prefixes = [...new Set(allPrefixes)].filter(Boolean);

  for (const prefix of prefixes) {
    if (key === prefix) return null;

    if (key.startsWith(`${prefix}/`)) {
      const stripped = normalizePath(key.slice(prefix.length + 1));
      return stripped || null;
    }

    const marker = `/${prefix}/`;
    const nestedIndex = key.indexOf(marker);
    if (nestedIndex >= 0) {
      const stripped = normalizePath(key.slice(nestedIndex + marker.length));
      return stripped || null;
    }
  }

  if (allowBareKey) {
    return key;
  }

  return null;
}

function migrateAssetUrlValue(
  value: string,
  target: StorageTarget,
): string | null {
  const raw = value.trim();
  if (!raw) return null;
  if (hasControlCharacters(raw)) return null;
  if (isLikelyLocalFilePath(raw)) return null;

  if (!looksLikeUrl(raw)) {
    const relative = deriveRelativeKey(
      raw,
      target,
      allowBareKeyForLiteralValue(raw),
    );
    if (!relative) return null;
    const next = buildPublicUrl(target, relative);
    return next === raw ? null : next;
  }

  const parsed = parseUrl(raw);
  if (!parsed) return null;

  const path = normalizePath(decodeURIComponent(parsed.pathname));
  const candidates: Array<{ key: string; allowBareKey: boolean }> = [];

  const fromBase = extractRelativePathFromConfiguredBase(path, target);
  if (fromBase) {
    candidates.push({ key: fromBase, allowBareKey: true });
  }

  const fromSupabase = extractSupabaseStoragePath(path);
  if (fromSupabase) {
    candidates.push({ key: fromSupabase.key, allowBareKey: true });
    candidates.push({
      key: `${fromSupabase.bucket}/${fromSupabase.key}`,
      allowBareKey: true,
    });
  }

  candidates.push({
    key: path,
    allowBareKey: isKnownStorageHost(parsed, target),
  });

  const seen = new Set<string>();
  for (const candidate of candidates) {
    const cacheKey = `${candidate.key}::${candidate.allowBareKey ? '1' : '0'}`;
    if (seen.has(cacheKey)) continue;
    seen.add(cacheKey);

    const relative = deriveRelativeKey(
      candidate.key,
      target,
      candidate.allowBareKey,
    );
    if (!relative) continue;

    const next = buildPublicUrl(target, relative);
    if (next !== raw) {
      return next;
    }
  }

  return null;
}

function addSample(
  result: MigrationResult,
  sample: MigrationSample,
  max = SAMPLE_LIMIT_PER_TABLE,
) {
  if (result.samples.length >= max) return;
  result.samples.push(sample);
}

function parseOptions(): MigrateOptions {
  const apply = hasFlag('--apply');
  const limitRaw = getArg('--limit');
  const onlyRaw = getArg('--only');

  let limit: number | undefined;
  if (limitRaw !== undefined) {
    const parsed = Number.parseInt(limitRaw, 10);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      throw new Error(`Invalid --limit value: ${limitRaw}`);
    }
    limit = parsed;
  }

  const onlyTables = new Set<MigrationTable>();
  if (onlyRaw) {
    for (const token of onlyRaw.split(',')) {
      const table = token.trim() as MigrationTable;
      if (!ALL_TABLES.includes(table)) {
        throw new Error(
          `Invalid table in --only: ${token}. Allowed: ${ALL_TABLES.join(', ')}`,
        );
      }
      onlyTables.add(table);
    }
  } else {
    ALL_TABLES.forEach((table) => onlyTables.add(table));
  }

  return {
    apply,
    limit,
    onlyTables,
  };
}

function printHelp() {
  console.log(`
Usage:
  npx tsx scripts/migrate-storage-urls-to-r2.ts [--apply] [--limit N] [--only table1,table2]

Defaults:
  - Runs in dry-run mode (no DB writes)
  - Scans all tables: ${ALL_TABLES.join(', ')}

Examples:
  npx tsx scripts/migrate-storage-urls-to-r2.ts
  npx tsx scripts/migrate-storage-urls-to-r2.ts --only users,users_honors --limit 200
  npx tsx scripts/migrate-storage-urls-to-r2.ts --apply
`.trim());
}

function getRequiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function getOptionalEnv(name: string, defaultValue = ''): string {
  const value = process.env[name];
  if (value === undefined || value === null) {
    return defaultValue;
  }
  return value.trim();
}

function loadStorageTargets() {
  const userProfiles: StorageTarget = {
    name: 'USER_PROFILES',
    bucket: getRequiredEnv('R2_BUCKET_USER_PROFILES'),
    publicBaseUrl: getRequiredEnv('R2_PUBLIC_URL_USER_PROFILES'),
    keyPrefix: getOptionalEnv('R2_KEY_PREFIX_USER_PROFILES', ''),
    // IMPORTANT: 'user-profiles' is NOT a legacy prefix — it is the active
    // keyPrefix for this bucket (R2_KEY_PREFIX_USER_PROFILES=user-profiles).
    // If it were listed here, deriveRelativeKey would strip it from working
    // URLs and buildPublicUrl would reconstruct them WITHOUT the prefix,
    // breaking every stored URL that is currently valid.
    //
    // 'profile-pictures' was the Supabase storage bucket name used before
    // the R2 migration and is a genuine legacy path to rewrite.
    legacyPrefixes: ['profile-pictures'],
  };

  const honorsImages: StorageTarget = {
    name: 'HONORS_IMAGES',
    bucket: getRequiredEnv('R2_BUCKET_HONORS_IMAGES'),
    publicBaseUrl: getRequiredEnv('R2_PUBLIC_URL_HONORS_IMAGES'),
    keyPrefix: getOptionalEnv('R2_KEY_PREFIX_HONORS_IMAGES', ''),
    legacyPrefixes: ['honors', 'secure-documents/honors'],
  };

  const honorsPdf: StorageTarget = {
    name: 'HONORS_PDF',
    bucket: getRequiredEnv('R2_BUCKET_HONORS_PDF'),
    publicBaseUrl: getRequiredEnv('R2_PUBLIC_URL_HONORS_PDF'),
    keyPrefix: getOptionalEnv('R2_KEY_PREFIX_HONORS_PDF', ''),
    legacyPrefixes: ['honors_pdf', 'secure-documents/honors_pdf'],
  };

  const usersHonors: StorageTarget = {
    name: 'USERS_HONORS',
    bucket: getRequiredEnv('R2_BUCKET_USERS_HONORS'),
    publicBaseUrl: getRequiredEnv('R2_PUBLIC_URL_USERS_HONORS'),
    keyPrefix: getOptionalEnv('R2_KEY_PREFIX_USERS_HONORS', ''),
    legacyPrefixes: ['users_honors', 'secure-documents/users_honors'],
  };

  const usersHonorsCert: StorageTarget = {
    name: 'USERS_HONORS_CERT',
    bucket: getRequiredEnv('R2_BUCKET_USERS_HONORS_CERT'),
    publicBaseUrl: getRequiredEnv('R2_PUBLIC_URL_USERS_HONORS_CERT'),
    keyPrefix: getOptionalEnv('R2_KEY_PREFIX_USERS_HONORS_CERT', ''),
    legacyPrefixes: ['users_honors_cert', 'secure-documents/users_honors_cert'],
  };

  const classesDocuments: StorageTarget = {
    name: 'CLASSES_DOCUMENTS',
    bucket: getRequiredEnv('R2_BUCKET_CLASSES_DOCUMENTS'),
    publicBaseUrl: getRequiredEnv('R2_PUBLIC_URL_CLASSES_DOCUMENTS'),
    keyPrefix: getOptionalEnv('R2_KEY_PREFIX_CLASSES_DOCUMENTS', ''),
    legacyPrefixes: ['classes', 'secure-documents/classes'],
  };

  const activitiesImages: StorageTarget = {
    name: 'ACTIVITIES_IMAGES',
    bucket: getRequiredEnv('R2_BUCKET_ACTIVITIES_IMAGES'),
    publicBaseUrl: getRequiredEnv('R2_PUBLIC_URL_ACTIVITIES_IMAGES'),
    keyPrefix: getOptionalEnv('R2_KEY_PREFIX_ACTIVITIES_IMAGES', ''),
    legacyPrefixes: ['activities', 'secure-documents/activities'],
  };

  return {
    userProfiles,
    honorsImages,
    honorsPdf,
    usersHonors,
    usersHonorsCert,
    classesDocuments,
    activitiesImages,
  };
}

async function migrateUsers(
  prisma: PrismaClient,
  options: MigrateOptions,
  targets: ReturnType<typeof loadStorageTargets>,
): Promise<MigrationResult> {
  const result: MigrationResult = {
    table: 'users',
    scanned: 0,
    changed: 0,
    applied: 0,
    errors: 0,
    samples: [],
  };

  const rows = await prisma.users.findMany({
    where: { user_image: { not: null } },
    select: { user_id: true, user_image: true },
    ...(options.limit ? { take: options.limit } : {}),
  });

  for (const row of rows) {
    result.scanned += 1;
    if (!row.user_image) continue;

    const migrated = migrateAssetUrlValue(row.user_image, targets.userProfiles);
    if (!migrated || migrated === row.user_image) continue;

    result.changed += 1;
    addSample(result, {
      id: row.user_id,
      field: 'user_image',
      before: row.user_image,
      after: migrated,
    });

    if (!options.apply) continue;

    try {
      await prisma.users.update({
        where: { user_id: row.user_id },
        data: { user_image: migrated },
      });
      result.applied += 1;
    } catch (error) {
      result.errors += 1;
      console.error(
        `[users:${row.user_id}] Failed to update user_image`,
        error,
      );
    }
  }

  return result;
}

async function migrateActivities(
  prisma: PrismaClient,
  options: MigrateOptions,
  targets: ReturnType<typeof loadStorageTargets>,
): Promise<MigrationResult> {
  const result: MigrationResult = {
    table: 'activities',
    scanned: 0,
    changed: 0,
    applied: 0,
    errors: 0,
    samples: [],
  };

  const rows = await prisma.activities.findMany({
    select: { activity_id: true, image: true },
    ...(options.limit ? { take: options.limit } : {}),
  });

  for (const row of rows) {
    result.scanned += 1;

    const migrated = migrateAssetUrlValue(row.image, targets.activitiesImages);
    if (!migrated || migrated === row.image) continue;

    result.changed += 1;
    addSample(result, {
      id: String(row.activity_id),
      field: 'image',
      before: row.image,
      after: migrated,
    });

    if (!options.apply) continue;

    try {
      await prisma.activities.update({
        where: { activity_id: row.activity_id },
        data: { image: migrated },
      });
      result.applied += 1;
    } catch (error) {
      result.errors += 1;
      console.error(
        `[activities:${row.activity_id}] Failed to update image`,
        error,
      );
    }
  }

  return result;
}

async function migrateHonors(
  prisma: PrismaClient,
  options: MigrateOptions,
  targets: ReturnType<typeof loadStorageTargets>,
): Promise<MigrationResult> {
  const result: MigrationResult = {
    table: 'honors',
    scanned: 0,
    changed: 0,
    applied: 0,
    errors: 0,
    samples: [],
  };

  const rows = await prisma.honors.findMany({
    select: { honor_id: true, honor_image: true, material_url: true },
    ...(options.limit ? { take: options.limit } : {}),
  });

  for (const row of rows) {
    result.scanned += 1;

    const nextImage = migrateAssetUrlValue(
      row.honor_image,
      targets.honorsImages,
    );
    const nextMaterial = migrateAssetUrlValue(
      row.material_url,
      targets.honorsPdf,
    );

    const data: Prisma.honorsUncheckedUpdateInput = {};

    if (nextImage && nextImage !== row.honor_image) {
      data.honor_image = nextImage;
      result.changed += 1;
      addSample(result, {
        id: String(row.honor_id),
        field: 'honor_image',
        before: row.honor_image,
        after: nextImage,
      });
    }

    if (nextMaterial && nextMaterial !== row.material_url) {
      data.material_url = nextMaterial;
      result.changed += 1;
      addSample(result, {
        id: String(row.honor_id),
        field: 'material_url',
        before: row.material_url,
        after: nextMaterial,
      });
    }

    if (Object.keys(data).length === 0 || !options.apply) {
      continue;
    }

    try {
      await prisma.honors.update({
        where: { honor_id: row.honor_id },
        data,
      });
      result.applied += 1;
    } catch (error) {
      result.errors += 1;
      console.error(`[honors:${row.honor_id}] Failed to update`, error);
    }
  }

  return result;
}

async function migrateClasses(
  prisma: PrismaClient,
  options: MigrateOptions,
  targets: ReturnType<typeof loadStorageTargets>,
): Promise<MigrationResult> {
  const result: MigrationResult = {
    table: 'classes',
    scanned: 0,
    changed: 0,
    applied: 0,
    errors: 0,
    samples: [],
  };

  const rows = await prisma.classes.findMany({
    where: { material_url: { not: null } },
    select: { class_id: true, material_url: true },
    ...(options.limit ? { take: options.limit } : {}),
  });

  for (const row of rows) {
    result.scanned += 1;
    if (!row.material_url) continue;

    const migrated = migrateAssetUrlValue(
      row.material_url,
      targets.classesDocuments,
    );
    if (!migrated || migrated === row.material_url) continue;

    result.changed += 1;
    addSample(result, {
      id: String(row.class_id),
      field: 'material_url',
      before: row.material_url,
      after: migrated,
    });

    if (!options.apply) continue;

    try {
      await prisma.classes.update({
        where: { class_id: row.class_id },
        data: { material_url: migrated },
      });
      result.applied += 1;
    } catch (error) {
      result.errors += 1;
      console.error(
        `[classes:${row.class_id}] Failed to update material_url`,
        error,
      );
    }
  }

  return result;
}

async function migrateUsersHonors(
  prisma: PrismaClient,
  options: MigrateOptions,
  targets: ReturnType<typeof loadStorageTargets>,
): Promise<MigrationResult> {
  const result: MigrationResult = {
    table: 'users_honors',
    scanned: 0,
    changed: 0,
    applied: 0,
    errors: 0,
    samples: [],
  };

  const rows = await prisma.users_honors.findMany({
    select: {
      user_honor_id: true,
      certificate: true,
      document: true,
      images: true,
    },
    ...(options.limit ? { take: options.limit } : {}),
  });

  for (const row of rows) {
    result.scanned += 1;

    const data: Prisma.users_honorsUncheckedUpdateInput = {};

    const nextCertificate = row.certificate
      ? migrateAssetUrlValue(row.certificate, targets.usersHonorsCert)
      : null;
    if (nextCertificate && nextCertificate !== row.certificate) {
      data.certificate = nextCertificate;
      result.changed += 1;
      addSample(result, {
        id: String(row.user_honor_id),
        field: 'certificate',
        before: row.certificate,
        after: nextCertificate,
      });
    }

    const nextDocument =
      typeof row.document === 'string'
        ? migrateAssetUrlValue(row.document, targets.usersHonors)
        : null;
    if (nextDocument && nextDocument !== row.document) {
      data.document = nextDocument;
      result.changed += 1;
      addSample(result, {
        id: String(row.user_honor_id),
        field: 'document',
        before: row.document ?? '',
        after: nextDocument,
      });
    }

    if (Array.isArray(row.images)) {
      const mappedImages = row.images.map((entry) => {
        if (typeof entry !== 'string') return entry;
        return migrateAssetUrlValue(entry, targets.usersHonors) ?? entry;
      });

      if (JSON.stringify(mappedImages) !== JSON.stringify(row.images)) {
        data.images = mappedImages as Prisma.InputJsonValue;
        result.changed += 1;
        addSample(result, {
          id: String(row.user_honor_id),
          field: 'images',
          before: JSON.stringify(row.images),
          after: JSON.stringify(mappedImages),
        });
      }
    }

    if (Object.keys(data).length === 0 || !options.apply) {
      continue;
    }

    try {
      await prisma.users_honors.update({
        where: { user_honor_id: row.user_honor_id },
        data,
      });
      result.applied += 1;
    } catch (error) {
      result.errors += 1;
      console.error(
        `[users_honors:${row.user_honor_id}] Failed to update`,
        error,
      );
    }
  }

  return result;
}

function printResultSummary(results: MigrationResult[], options: MigrateOptions) {
  const totals = results.reduce(
    (acc, item) => {
      acc.scanned += item.scanned;
      acc.changed += item.changed;
      acc.applied += item.applied;
      acc.errors += item.errors;
      return acc;
    },
    { scanned: 0, changed: 0, applied: 0, errors: 0 },
  );

  console.log('\nStorage URL migration summary');
  console.log(`Mode: ${options.apply ? 'APPLY (writes enabled)' : 'DRY RUN'}`);
  if (options.limit) {
    console.log(`Limit per table: ${options.limit}`);
  }

  console.table(
    results.map((item) => ({
      table: item.table,
      scanned: item.scanned,
      changed: item.changed,
      applied: item.applied,
      errors: item.errors,
    })),
  );

  console.log(
    `Totals -> scanned: ${totals.scanned}, changed: ${totals.changed}, applied: ${totals.applied}, errors: ${totals.errors}`,
  );

  for (const result of results) {
    if (result.samples.length === 0) continue;
    console.log(`\nSamples for ${result.table}:`);
    for (const sample of result.samples) {
      console.log(
        `- [${sample.id}] ${sample.field}\n  before: ${sample.before}\n  after : ${sample.after}`,
      );
    }
  }
}

async function main() {
  if (hasFlag('--help') || hasFlag('-h')) {
    printHelp();
    process.exit(0);
  }

  const options = parseOptions();
  const targets = loadStorageTargets();
  const connectionString = getRequiredEnv('DATABASE_URL');
  const pool = new Pool({ connectionString });
  const adapter = new PrismaPg(pool);
  const prisma = new PrismaClient({ adapter });
  const results: MigrationResult[] = [];

  console.log(
    `Starting storage URL migration in ${options.apply ? 'APPLY' : 'DRY RUN'} mode...`,
  );

  try {
    if (options.onlyTables.has('users')) {
      results.push(await migrateUsers(prisma, options, targets));
    }
    if (options.onlyTables.has('activities')) {
      results.push(await migrateActivities(prisma, options, targets));
    }
    if (options.onlyTables.has('honors')) {
      results.push(await migrateHonors(prisma, options, targets));
    }
    if (options.onlyTables.has('classes')) {
      results.push(await migrateClasses(prisma, options, targets));
    }
    if (options.onlyTables.has('users_honors')) {
      results.push(await migrateUsersHonors(prisma, options, targets));
    }
  } finally {
    await prisma.$disconnect();
    await pool.end();
  }

  printResultSummary(results, options);

  const totalErrors = results.reduce((sum, item) => sum + item.errors, 0);
  if (totalErrors > 0) {
    process.exit(1);
  }
}

main().catch((error) => {
  console.error('Storage URL migration failed:', error);
  process.exit(1);
});
