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
 *   npx tsx scripts/family-profiles/seed-dev-guardianships.ts --from-legal-reps
 *
 * Write the planned rows (needs a mode flag AND --apply):
 *   npx tsx scripts/family-profiles/seed-dev-guardianships.ts --placeholders --apply
 *
 * MODES
 * -----
 * --placeholders     Dependents without an active guardianship get a TEST row:
 *                    is_test_data=true, verification_method='test_placeholder'.
 *                    Test rows never count as consent (resolver and approve gate ignore them).
 * --from-legal-reps  legal_representatives rows become `pending` guardianships with
 *                    verification_method='legacy_import'. External representatives get
 *                    guardian_user_id NULL plus external_name / external_phone.
 *
 * Requires DATABASE_URL (loaded from .env). Refuses to run when NODE_ENV=production.
 */

export interface SeedOptions {
  placeholders: boolean;
  fromLegalReps: boolean;
  apply: boolean;
}

export interface LegalRepresentativeRow {
  userId: string;
  representativeUserId: string | null;
  name: string | null;
  paternalLastName: string | null;
  maternalLastName: string | null;
  phone: string | null;
  relationshipTypeId: string | null;
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
  /** Legal representatives whose user has no non-revoked guardianship row. */
  listLegalRepresentativesWithoutGuardianship(): Promise<
    LegalRepresentativeRow[]
  >;
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
    fromLegalReps: false,
    apply: false,
  };
  for (const arg of args) {
    if (arg === '--placeholders') options.placeholders = true;
    else if (arg === '--from-legal-reps') options.fromLegalReps = true;
    else if (arg === '--apply') options.apply = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return options;
}

function externalNameOf(row: LegalRepresentativeRow): string | null {
  const full = [row.name, row.paternalLastName, row.maternalLastName]
    .filter((part): part is string => Boolean(part && part.trim()))
    .join(' ')
    .trim();
  return full.length > 0 ? full.slice(0, 150) : null;
}

export async function planSeed(
  options: SeedOptions,
  store: SeedStore,
): Promise<GuardianshipSeedRow[]> {
  const planned: GuardianshipSeedRow[] = [];
  const covered = new Set<string>();

  if (options.fromLegalReps) {
    for (const row of await store.listLegalRepresentativesWithoutGuardianship()) {
      if (row.representativeUserId === row.userId) continue;
      const externalName = row.representativeUserId
        ? null
        : externalNameOf(row);
      // The holder CHECK needs a guardian user or an external name.
      if (!row.representativeUserId && !externalName) continue;
      covered.add(row.userId);
      planned.push({
        dependentUserId: row.userId,
        guardianUserId: row.representativeUserId,
        relationshipTypeId: row.relationshipTypeId,
        isPrimary: true,
        consentStatus: 'pending',
        verificationMethod: 'legacy_import',
        verifiedAt: null,
        externalName,
        externalPhone: row.representativeUserId
          ? null
          : (row.phone?.slice(0, 20) ?? null),
        isTestData: false,
      });
    }
  }

  if (options.placeholders) {
    for (const userId of await store.listDependentsWithoutGuardianship()) {
      if (covered.has(userId)) continue;
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
  if (!options.placeholders && !options.fromLegalReps) {
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
    async listLegalRepresentativesWithoutGuardianship() {
      const rows = await prisma.legal_representatives.findMany({
        where: {
          users: {
            guardianships_as_dependent: {
              none: { consent_status: { not: 'revoked' } },
            },
          },
        },
      });
      return rows.map((row) => ({
        userId: row.user_id,
        representativeUserId: row.representative_user_id,
        name: row.name,
        paternalLastName: row.paternal_last_name,
        maternalLastName: row.maternal_last_name,
        phone: row.phone,
        relationshipTypeId: row.relationship_type_id,
      }));
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
  if (!options.placeholders && !options.fromLegalReps) {
    console.log(
      'Nothing to do. Pass --placeholders and/or --from-legal-reps (add --apply to write).',
    );
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
