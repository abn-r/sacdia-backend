/**
 * backfill-supervised-logins.ts
 *
 * DEV-ONLY helper for family profiles Phase 3a. Run it by hand, once per Neon
 * branch, AFTER migration 20261020120000_family_teen_login is applied.
 * The migration contains no data copy on purpose.
 *
 * It creates `self_registered` supervised_logins rows for existing account
 * holders aged 13-17 (country policy, calendar math in the country TZ):
 *   - with a guardianship (non-custodian, non-revoked) -> pending_since NULL
 *   - without one                                       -> pending_since now()
 *     (the 90-day guardian-less clock starts at the backfill, not at signup).
 *
 * The principal resolver treats a minor account holder without a row as pending
 * anyway (fail closed); this script only feeds the reminder cron.
 *
 * HOW TO RUN
 * ----------
 * Dry-run (default, plans rows, writes NOTHING):
 *   npx tsx scripts/family-profiles/backfill-supervised-logins.ts
 * Write the planned rows:
 *   npx tsx scripts/family-profiles/backfill-supervised-logins.ts --apply
 *
 * Idempotent: users that already have a row are never touched, and the insert
 * uses skipDuplicates. Requires DATABASE_URL (loaded from .env).
 * Refuses to run when NODE_ENV=production.
 */
import {
  DEFAULT_COUNTRY_AGE_POLICY,
  type CountryAgePolicy,
} from '../../src/common/age/country-age-policy.service';
import { ageToday } from '../../src/common/age/age.util';

export interface BackfillOptions {
  apply: boolean;
}

/** An account holder without a supervised_logins row. */
export interface AccountHolderRow {
  userId: string;
  birthday: Date;
  policy: CountryAgePolicy | null;
  hasGuardianship: boolean;
}

export interface SupervisedLoginBackfillRow {
  userId: string;
  pendingSince: Date | null;
}

/** Read/write seam so the planning logic is testable without a database. */
export interface BackfillStore {
  /** Active account holders with a birthday and NO supervised_logins row. */
  listAccountHoldersWithoutRow(): Promise<AccountHolderRow[]>;
  /** Must be idempotent (skipDuplicates). Returns the rows actually written. */
  insertRows(rows: SupervisedLoginBackfillRow[]): Promise<number>;
}

export interface BackfillResult {
  mode: 'dry-run' | 'apply';
  planned: SupervisedLoginBackfillRow[];
  written: number;
}

export function parseBackfillArgs(args: string[]): BackfillOptions {
  const options: BackfillOptions = { apply: false };
  for (const arg of args) {
    if (arg === '--apply') options.apply = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return options;
}

export async function planBackfill(
  store: BackfillStore,
  now: Date = new Date(),
): Promise<SupervisedLoginBackfillRow[]> {
  const planned: SupervisedLoginBackfillRow[] = [];
  const seen = new Set<string>();
  for (const holder of await store.listAccountHoldersWithoutRow()) {
    if (seen.has(holder.userId)) continue;
    const policy = holder.policy ?? DEFAULT_COUNTRY_AGE_POLICY;
    const age = ageToday(holder.birthday, policy.timeZone, now);
    // 13-17 by default; the bounds follow the country policy.
    if (age < policy.minSelfLoginAge || age >= policy.ageOfMajority) continue;
    seen.add(holder.userId);
    planned.push({
      userId: holder.userId,
      pendingSince: holder.hasGuardianship ? null : now,
    });
  }
  return planned;
}

/** Writes only when --apply is present. */
export async function runBackfill(
  options: BackfillOptions,
  store: BackfillStore,
  now: Date = new Date(),
): Promise<BackfillResult> {
  const planned = await planBackfill(store, now);
  if (!options.apply) {
    return { mode: 'dry-run', planned, written: 0 };
  }
  const written = planned.length > 0 ? await store.insertRows(planned) : 0;
  return { mode: 'apply', planned, written };
}

async function createPrismaStore(): Promise<{
  store: BackfillStore;
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

  const store: BackfillStore = {
    async listAccountHoldersWithoutRow() {
      const users = await prisma.users.findMany({
        where: {
          active: true,
          birthday: { not: null },
          account: { some: {} },
          supervised_login: { is: null },
        },
        select: {
          user_id: true,
          birthday: true,
          countries: {
            select: {
              minor_self_login_min_age: true,
              age_of_majority: true,
              age_reference_timezone: true,
            },
          },
          guardianships_as_dependent: {
            where: { consent_status: { not: 'revoked' }, is_custodian: false },
            select: { guardianship_id: true },
            take: 1,
          },
        },
      });
      return users.map((user) => ({
        userId: user.user_id,
        birthday: user.birthday as Date,
        policy: user.countries
          ? {
              minSelfLoginAge: user.countries.minor_self_login_min_age,
              ageOfMajority: user.countries.age_of_majority,
              timeZone:
                user.countries.age_reference_timezone ??
                DEFAULT_COUNTRY_AGE_POLICY.timeZone,
            }
          : null,
        hasGuardianship: user.guardianships_as_dependent.length > 0,
      }));
    },
    async insertRows(rows) {
      const result = await prisma.supervised_logins.createMany({
        data: rows.map((row) => ({
          user_id: row.userId,
          method: 'email',
          origin: 'self_registered',
          password_set_by: 'self',
          pending_since: row.pendingSince,
          pending_reminder_level: 0,
        })),
        skipDuplicates: true,
      });
      return result.count;
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
    throw new Error('backfill-supervised-logins is dev-only; refusing to run.');
  }
  const options = parseBackfillArgs(process.argv.slice(2));

  await import('dotenv/config');
  const { store, close } = await createPrismaStore();
  try {
    const result = await runBackfill(options, store);
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
