/**
 * seed-enrollments-demo.ts
 *
 * DEV-ONLY demo data for the validation queue of annual club enrollments
 * (`GET /club-enrollments/validation/queue`): 2-3 `pending_validation`
 * enrollments of the current ecclesiastical year, one per active club section
 * that has no enrollment yet that year and has an active director (the
 * director is the submitter and the board director).
 *
 * HOW TO RUN
 * ----------
 * Nothing happens without a mode flag (prints the usage and exits):
 *   npx tsx scripts/demo/seed-enrollments-demo.ts
 *
 * Dry-run (reads the DB, prints the plan, writes NOTHING):
 *   npx tsx scripts/demo/seed-enrollments-demo.ts --demo
 *   npx tsx scripts/demo/seed-enrollments-demo.ts --cleanup
 *
 * Write (mode flag AND --apply):
 *   npx tsx scripts/demo/seed-enrollments-demo.ts --demo --apply
 *   npx tsx scripts/demo/seed-enrollments-demo.ts --cleanup --apply
 *
 * IDEMPOTENT: enrollment ids are deterministic UUIDs derived from
 * (section, year), so a second run updates the same rows back to
 * `pending_validation` (clearing any review) and never duplicates. It never
 * touches an enrollment that is not one of its own (marked with the
 * "[DEMO]" address prefix and the deterministic id). --cleanup removes only
 * those rows, and only while they have no annual folder.
 *
 * SAFETY: refuses NODE_ENV=production and any DATABASE_URL that does not
 * contain the Neon DEVELOPMENT endpoint id. The host (no credentials) is
 * printed first.
 */

import { createHash } from 'crypto';

const DEV_ENDPOINT_ID = 'ep-rough-hill-anztwk76';
const PROD_ENDPOINT_ID = 'ep-dark-thunder-anpobd36';
const UUID_NAMESPACE = 'sacdia-demo-enrollments:v1';
const DEMO_ADDRESS_PREFIX = '[DEMO] ';
const MAX_DEMO_ENROLLMENTS = 3;
const DIRECTOR_ROLE_NAME = 'director';

export interface DemoOptions {
  demo: boolean;
  cleanup: boolean;
  apply: boolean;
}

export function parseDemoArgs(args: string[]): DemoOptions {
  const options: DemoOptions = { demo: false, cleanup: false, apply: false };
  for (const arg of args) {
    if (arg === '--demo') options.demo = true;
    else if (arg === '--cleanup') options.cleanup = true;
    else if (arg === '--apply') options.apply = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  if (options.demo && options.cleanup) {
    throw new Error('Pass --demo OR --cleanup, not both.');
  }
  return options;
}

/** UUID (v5-shaped) derived from a stable key: same key, same id, every run. */
export function demoEnrollmentId(sectionId: number, yearId: number): string {
  const h = createHash('sha1')
    .update(`${UUID_NAMESPACE}:section:${sectionId}:year:${yearId}`)
    .digest();
  h[6] = (h[6] & 0x0f) | 0x50;
  h[8] = (h[8] & 0x3f) | 0x80;
  const x = h.subarray(0, 16).toString('hex');
  return `${x.slice(0, 8)}-${x.slice(8, 12)}-${x.slice(12, 16)}-${x.slice(16, 20)}-${x.slice(20, 32)}`;
}

async function createPrisma(databaseUrl: string) {
  const [{ PrismaClient }, { PrismaPg }, pg] = await Promise.all([
    import('@prisma/client'),
    import('@prisma/adapter-pg'),
    import('pg'),
  ]);
  const pool = new pg.default.Pool({ connectionString: databaseUrl });
  const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });
  return {
    prisma,
    close: async () => {
      await prisma.$disconnect();
      await pool.end();
    },
  };
}

type Prisma_ = Awaited<ReturnType<typeof createPrisma>>['prisma'];

function assertDevDatabase(databaseUrl: string | undefined): string {
  if (!databaseUrl) throw new Error('Missing required env var: DATABASE_URL');
  if (databaseUrl.includes(PROD_ENDPOINT_ID)) {
    throw new Error('DATABASE_URL points to PRODUCTION. Refusing to run.');
  }
  if (!databaseUrl.includes(DEV_ENDPOINT_ID)) {
    throw new Error(
      `DATABASE_URL does not contain the Neon development endpoint (${DEV_ENDPOINT_ID}). Refusing to run.`,
    );
  }
  let host = '(unparseable)';
  try {
    host = new URL(databaseUrl).host; // host only, never credentials
  } catch {
    /* keep placeholder */
  }
  return host;
}

async function currentYearId(prisma: Prisma_): Promise<number> {
  const today = new Date();
  const year = await prisma.ecclesiastical_years.findFirst({
    where: { start_date: { lte: today }, end_date: { gte: today } },
    select: { year_id: true },
  });
  if (!year) throw new Error('No current ecclesiastical year configured.');
  return year.year_id;
}

async function runDemo(prisma: Prisma_, apply: boolean): Promise<void> {
  const yearId = await currentYearId(prisma);

  // Sections already holding a DEMO enrollment this year (re-run: reset them),
  // then active sections without any enrollment this year.
  const demoRows = await prisma.club_enrollments.findMany({
    where: {
      ecclesiastical_year_id: yearId,
      address: { startsWith: DEMO_ADDRESS_PREFIX },
    },
    select: { club_section_id: true },
  });
  const sectionIds = new Set(demoRows.map((row) => row.club_section_id));

  if (sectionIds.size < MAX_DEMO_ENROLLMENTS) {
    const free = await prisma.club_sections.findMany({
      where: {
        active: true,
        main_club_id: { not: null },
        club_enrollments: { none: { ecclesiastical_year_id: yearId } },
      },
      select: { club_section_id: true },
      orderBy: { club_section_id: 'asc' },
      take: 20,
    });
    for (const { club_section_id } of free) {
      if (sectionIds.size >= MAX_DEMO_ENROLLMENTS) break;
      sectionIds.add(club_section_id);
    }
  }

  let planned = 0;
  for (const sectionId of [...sectionIds].sort((a, b) => a - b)) {
    const director = await prisma.club_role_assignments.findFirst({
      where: {
        club_section_id: sectionId,
        ecclesiastical_year_id: yearId,
        active: true,
        status: 'active',
        roles: { role_name: DIRECTOR_ROLE_NAME },
      },
      select: { user_id: true },
    });
    if (!director) {
      console.log(`- section ${sectionId}: no active director, skipped`);
      continue;
    }
    const id = demoEnrollmentId(sectionId, yearId);
    const data = {
      status: 'pending_validation',
      address: `${DEMO_ADDRESS_PREFIX}Calle Demo ${sectionId}, Centro`,
      meeting_days: 'Sábado',
      meeting_schedule: [{ day: 'Sábado', time: '09:00' }],
      souls_target: 10 + planned * 5,
      fee: planned % 2 === 0,
      fee_amount: planned % 2 === 0 ? 25 : null,
      director_id: director.user_id,
      deputy_director_ids: [] as string[],
      created_by: director.user_id,
      reviewed_by_id: null,
      reviewer_role: null,
      reviewed_at: null,
      decision_reason: null,
      modified_at: new Date(),
    };
    console.log(
      `- section ${sectionId}: enrollment ${id} -> pending_validation (director ${director.user_id})`,
    );
    planned += 1;
    if (!apply) continue;
    await prisma.club_enrollments.upsert({
      where: { club_enrollment_id: id },
      create: {
        club_enrollment_id: id,
        club_section_id: sectionId,
        ecclesiastical_year_id: yearId,
        ...data,
      },
      update: data,
    });
  }
  console.log(
    apply
      ? `Done: ${planned} demo enrollment(s) written.`
      : `Dry-run: ${planned} demo enrollment(s) planned. Re-run with --apply to write.`,
  );
}

async function runCleanup(prisma: Prisma_, apply: boolean): Promise<void> {
  const rows = await prisma.club_enrollments.findMany({
    where: {
      address: { startsWith: DEMO_ADDRESS_PREFIX },
      annual_folder: { is: null },
    },
    select: {
      club_enrollment_id: true,
      club_section_id: true,
      ecclesiastical_year_id: true,
    },
  });
  const demoIds = rows
    .filter(
      (row) =>
        row.club_enrollment_id ===
        demoEnrollmentId(row.club_section_id, row.ecclesiastical_year_id),
    )
    .map((row) => row.club_enrollment_id);
  for (const id of demoIds) console.log(`- enrollment ${id} would be removed`);
  if (!apply) {
    console.log(
      `Dry-run: ${demoIds.length} enrollment(s). Re-run with --apply.`,
    );
    return;
  }
  const result = await prisma.club_enrollments.deleteMany({
    where: { club_enrollment_id: { in: demoIds } },
  });
  console.log(`Done: ${result.count} demo enrollment(s) removed.`);
}

function printUsage(): void {
  console.log(`seed-enrollments-demo (DEV-ONLY)

Nothing to do. Pick a mode:
  npx tsx scripts/demo/seed-enrollments-demo.ts --demo             dry-run: plan the demo enrollments
  npx tsx scripts/demo/seed-enrollments-demo.ts --demo --apply     write them
  npx tsx scripts/demo/seed-enrollments-demo.ts --cleanup          dry-run: what would be removed
  npx tsx scripts/demo/seed-enrollments-demo.ts --cleanup --apply  remove them
`);
}

async function main(): Promise<void> {
  if (process.env.NODE_ENV === 'production') {
    throw new Error(
      'seed-enrollments-demo is dev-only; refusing to run (NODE_ENV=production).',
    );
  }
  const options = parseDemoArgs(process.argv.slice(2));
  if (!options.demo && !options.cleanup) {
    printUsage();
    return;
  }

  await import('dotenv/config');
  if (process.env.NODE_ENV === 'production') {
    throw new Error(
      'seed-enrollments-demo is dev-only; refusing to run (NODE_ENV=production).',
    );
  }
  const host = assertDevDatabase(process.env.DATABASE_URL);
  console.log(`Database host: ${host}`);

  const { prisma, close } = await createPrisma(
    process.env.DATABASE_URL as string,
  );
  try {
    if (options.demo) await runDemo(prisma, options.apply);
    else await runCleanup(prisma, options.apply);
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
