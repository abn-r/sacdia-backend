/**
 * seed-dev-guardianships.ts
 *
 * DEV-ONLY helper for family profiles. Run it by hand, once per Neon branch.
 * The 20261016120000_family_profiles migration contains no data copy on purpose.
 *
 * HOW TO RUN
 * ----------
 * Nothing happens without a mode flag (prints the usage and exits):
 *   npx tsx scripts/family-profiles/seed-dev-guardianships.ts
 *
 * Dry-run (default once a mode is chosen — plans rows, writes NOTHING):
 *   npx tsx scripts/family-profiles/seed-dev-guardianships.ts --placeholders
 *
 * Write the planned rows (needs a mode flag AND --apply):
 *   npx tsx scripts/family-profiles/seed-dev-guardianships.ts --placeholders --apply
 *
 * MODES
 * -----
 * --placeholders     Dependents without an active guardianship get a TEST row:
 *                    is_test_data=true, verification_method='test_placeholder'.
 *                    Test rows never count as consent (resolver and approve gate ignore them).
 * Requires DATABASE_URL (loaded from .env). Refuses to run when NODE_ENV=production.
 */

export interface SeedOptions {
  placeholders: boolean;
  apply: boolean;
}

export interface GuardianshipSeedRow {
  dependentUserId: string;
  guardianUserId: string | null;
  relationshipTypeId: string | null;
  isPrimary: true;
  consentStatus: 'pending' | 'verified';
  verificationMethod: 'legacy_import' | 'test_placeholder';
  verifiedAt: Date | null;
  externalName: string | null;
  externalPhone: string | null;
  isTestData: boolean;
}

/** Read/write seam so the planning logic is testable without a database. */
export interface SeedStore {
  /** Dependent profiles that have no non-revoked guardianship row. */
  listDependentsWithoutGuardianship(): Promise<string[]>;
  insertGuardianship(row: GuardianshipSeedRow): Promise<void>;
}

export interface SeedResult {
  mode: 'noop' | 'dry-run' | 'apply';
  planned: GuardianshipSeedRow[];
  written: number;
}

export function parseSeedArgs(args: string[]): SeedOptions {
  const options: SeedOptions = {
    placeholders: false,
    apply: false,
  };
  for (const arg of args) {
    if (arg === '--placeholders') options.placeholders = true;
    else if (arg === '--apply') options.apply = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return options;
}

export async function planSeed(
  options: SeedOptions,
  store: SeedStore,
): Promise<GuardianshipSeedRow[]> {
  const planned: GuardianshipSeedRow[] = [];
  if (options.placeholders) {
    for (const userId of await store.listDependentsWithoutGuardianship()) {
      planned.push({
        dependentUserId: userId,
        guardianUserId: null,
        relationshipTypeId: null,
        isPrimary: true,
        consentStatus: 'verified',
        verificationMethod: 'test_placeholder',
        verifiedAt: new Date(),
        externalName: 'Test placeholder guardian',
        externalPhone: null,
        isTestData: true,
      });
    }
  }

  return planned;
}

/**
 * Writes only when a mode flag AND --apply are both present. Without a mode
 * flag the store is never touched.
 */
export async function runSeed(
  options: SeedOptions,
  store: SeedStore,
): Promise<SeedResult> {
  if (!options.placeholders) {
    return { mode: 'noop', planned: [], written: 0 };
  }

  const planned = await planSeed(options, store);
  if (!options.apply) {
    return { mode: 'dry-run', planned, written: 0 };
  }

  let written = 0;
  for (const row of planned) {
    await store.insertGuardianship(row);
    written += 1;
  }
  return { mode: 'apply', planned, written };
}

async function createPrismaStore(): Promise<{
  store: SeedStore;
  close: () => Promise<void>;
}> {
  const [{ PrismaClient }, { PrismaPg }, pg] = await Promise.all([
    import('@prisma/client'),
    import('@prisma/adapter-pg'),
    import('pg'),
  ]);
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error('Missing required env var: DATABASE_URL');
  const pool = new pg.default.Pool({ connectionString: databaseUrl });
  const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

  const store: SeedStore = {
    async listDependentsWithoutGuardianship() {
      const rows = await prisma.dependent_profiles.findMany({
        where: {
          user: {
            guardianships_as_dependent: {
              none: { consent_status: { not: 'revoked' } },
            },
          },
        },
        select: { user_id: true },
      });
      return rows.map((row) => row.user_id);
    },
    async insertGuardianship(row) {
      await prisma.guardianships.create({
        data: {
          dependent_user_id: row.dependentUserId,
          guardian_user_id: row.guardianUserId,
          relationship_type_id: row.relationshipTypeId,
          is_primary: row.isPrimary,
          consent_status: row.consentStatus,
          verification_method: row.verificationMethod,
          verified_at: row.verifiedAt,
          external_name: row.externalName,
          external_phone: row.externalPhone,
          is_test_data: row.isTestData,
        },
      });
    },
  };

  return {
    store,
    close: async () => {
      await prisma.$disconnect();
      await pool.end();
    },
  };
}

async function main(): Promise<void> {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('seed-dev-guardianships is dev-only; refusing to run.');
  }
  const options = parseSeedArgs(process.argv.slice(2));
  if (!options.placeholders) {
    console.log('Nothing to do. Pass --placeholders (add --apply to write).');
    return;
  }

  await import('dotenv/config');
  const { store, close } = await createPrismaStore();
  try {
    const result = await runSeed(options, store);
    console.log(
      `[${result.mode}] planned=${result.planned.length} written=${result.written}`,
    );
  } finally {
    await close();
  }
}

if (require.main === module) {
  main().catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  });
}
