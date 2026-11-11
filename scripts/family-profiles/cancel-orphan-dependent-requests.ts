/**
 * cancel-orphan-dependent-requests.ts
 *
 * One-off cleanup for PENDING membership requests left behind by minors that
 * were purged before the purge started cancelling them. A purged dependent
 * (`dependent_profiles.purged_at` set) has no name or data left; its pending
 * request (`club_role_assignments`, status 'pending', active=true) shows up in
 * the director's list as a nameless applicant and can never be approved,
 * verified or handed to a family.
 *
 * The same purge also left the LIVE assignments of those dependents alive
 * (accepted memberships: status 'active'/'inactive', active=true, any role),
 * so the child stayed in the section's member list. The script ends them too.
 *
 * Each row is closed with the SAME writes the purge uses now
 * (`cancelPendingRequestsOfUsers`: status 'cancelled', active=false,
 * expires_at cleared, end_date and modified_at = now; and
 * `endLiveAssignmentsOfUsers`: status 'ended', active=false, end_date and
 * modified_at = now), both in one transaction per dependent. Enrollments are
 * not touched. Requests of FROZEN (not yet purged) dependents are left alone:
 * they are hidden from the lists and the purge cancels them later.
 *
 * HOW TO RUN
 * ----------
 * Nothing happens without a mode flag (prints the usage and exits):
 *   npx tsx scripts/family-profiles/cancel-orphan-dependent-requests.ts
 *
 * Dry-run (lists the rows, writes NOTHING):
 *   npx tsx scripts/family-profiles/cancel-orphan-dependent-requests.ts --dry-run
 *
 * Write (cancels the listed rows):
 *   npx tsx scripts/family-profiles/cancel-orphan-dependent-requests.ts --apply
 *
 * Works against any Neon branch (it reads DATABASE_URL from .env); point it at
 * the branch you mean to clean. Refuses to run when NODE_ENV=production.
 */
import {
  cancelPendingRequestsOfUsers,
  endLiveAssignmentsOfUsers,
} from '../../src/membership-requests/membership-request-cancellation';

export interface CleanupOptions {
  dryRun: boolean;
  apply: boolean;
}

export interface OrphanRequestRow {
  /** 'pending' request to cancel, or 'live' accepted assignment to end. */
  kind: 'pending' | 'live';
  assignmentId: string;
  userId: string;
  clubSectionId: number | null;
  createdAt: Date;
  purgedAt: Date;
}

/** Read/write seam so the planning logic is testable without a database. */
export interface CleanupStore {
  /**
   * Pending requests AND live (active/inactive) assignments whose dependent
   * profile is purged.
   */
  listOrphanRequests(): Promise<OrphanRequestRow[]>;
  /**
   * Cancels the pending requests and ends the live assignments of one
   * dependent in one transaction; returns the closed ids of each kind.
   */
  cancelForDependent(
    userId: string,
    now: Date,
  ): Promise<{ cancelled: string[]; ended: string[] }>;
}

export interface CleanupResult {
  mode: 'noop' | 'dry-run' | 'apply';
  rows: OrphanRequestRow[];
  cancelled: number;
  ended: number;
}

export function parseCleanupArgs(args: string[]): CleanupOptions {
  const options: CleanupOptions = { dryRun: false, apply: false };
  for (const arg of args) {
    if (arg === '--dry-run') options.dryRun = true;
    else if (arg === '--apply') options.apply = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return options;
}

function describeRow(row: OrphanRequestRow): string {
  return [
    `kind=${row.kind}`,
    `assignment=${row.assignmentId}`,
    `user=${row.userId}`,
    `section=${row.clubSectionId ?? 'null'}`,
    `created=${row.createdAt.toISOString()}`,
    `purged=${row.purgedAt.toISOString()}`,
  ].join(' ');
}

/** Writes only with `--apply`. Without a mode flag the store is never touched. */
export async function runCleanup(
  options: CleanupOptions,
  store: CleanupStore,
  log: (line: string) => void = console.log,
  now: Date = new Date(),
): Promise<CleanupResult> {
  if (!options.dryRun && !options.apply) {
    return { mode: 'noop', rows: [], cancelled: 0, ended: 0 };
  }

  const rows = await store.listOrphanRequests();
  const apply = options.apply;
  for (const row of rows) {
    const verb = row.kind === 'pending' ? 'cancel' : 'end';
    log(`${apply ? verb : `would ${verb}`}: ${describeRow(row)}`);
  }
  if (!apply) {
    return { mode: 'dry-run', rows, cancelled: 0, ended: 0 };
  }

  let cancelled = 0;
  let ended = 0;
  for (const userId of new Set(rows.map((row) => row.userId))) {
    const closed = await store.cancelForDependent(userId, now);
    cancelled += closed.cancelled.length;
    ended += closed.ended.length;
  }
  return { mode: 'apply', rows, cancelled, ended };
}

async function createPrismaStore(): Promise<{
  store: CleanupStore;
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

  const store: CleanupStore = {
    async listOrphanRequests() {
      const rows = await prisma.club_role_assignments.findMany({
        where: {
          OR: [
            { status: 'pending', active: true },
            { status: { in: ['active', 'inactive'] }, active: true },
          ],
          users: { dependent_profile: { is: { purged_at: { not: null } } } },
        },
        orderBy: [{ club_section_id: 'asc' }, { created_at: 'asc' }],
        select: {
          assignment_id: true,
          user_id: true,
          status: true,
          club_section_id: true,
          created_at: true,
          users: {
            select: { dependent_profile: { select: { purged_at: true } } },
          },
        },
      });
      return rows.map((row) => ({
        kind:
          row.status === 'pending' ? ('pending' as const) : ('live' as const),
        assignmentId: row.assignment_id,
        userId: row.user_id,
        clubSectionId: row.club_section_id,
        createdAt: row.created_at,
        purgedAt: row.users.dependent_profile!.purged_at!,
      }));
    },
    async cancelForDependent(userId, now) {
      return prisma.$transaction(async (tx) => ({
        cancelled: (await cancelPendingRequestsOfUsers(tx, [userId], now)).map(
          (row) => row.assignment_id,
        ),
        ended: (await endLiveAssignmentsOfUsers(tx, [userId], now)).map(
          (row) => row.assignment_id,
        ),
      }));
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
    throw new Error(
      'cancel-orphan-dependent-requests is a one-off cleanup; refusing to run with NODE_ENV=production.',
    );
  }
  const options = parseCleanupArgs(process.argv.slice(2));
  if (!options.dryRun && !options.apply) {
    console.log(
      'Nothing to do. Pass --dry-run to list the rows, or --apply to cancel/end them.',
    );
    return;
  }

  await import('dotenv/config');
  const { store, close } = await createPrismaStore();
  try {
    const result = await runCleanup(options, store);
    console.log(
      `[${result.mode}] orphan rows=${result.rows.length} (pending=${result.rows.filter((r) => r.kind === 'pending').length} live=${result.rows.filter((r) => r.kind === 'live').length}) cancelled=${result.cancelled} ended=${result.ended}`,
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
