/**
 * seed-finances-demo.ts
 *
 * DEV-ONLY demo data for the finance screens (summary, by-category, export,
 * Local Field overview, month-end reminder, finance ranking score): about 3
 * months of movements (several income / expense categories) for 2-3 club
 * sections, with a mix of cases:
 *   - months with movements created BEFORE the month closing (count for the
 *     ranking),
 *   - months left EMPTY (the ranking marks them as missed),
 *   - one movement created AFTER the closing, with its closing note (admin
 *     late entry, does not count for the ranking),
 *   - the current month empty for the first section (month-end reminder).
 *
 * HOW TO RUN
 * ----------
 * Dry-run (DEFAULT: reads the DB, prints the plan, writes NOTHING):
 *   npx tsx scripts/demo/seed-finances-demo.ts
 *   npx tsx scripts/demo/seed-finances-demo.ts --sections=163,166
 *
 * Write:
 *   npx tsx scripts/demo/seed-finances-demo.ts --apply
 *
 * Remove the demo rows (dry-run by default, --apply to delete):
 *   npx tsx scripts/demo/seed-finances-demo.ts --cleanup
 *   npx tsx scripts/demo/seed-finances-demo.ts --cleanup --apply
 *
 * Default sections: 163 (Estella, Aventureros) and 166 (Club Panteras).
 *
 * IDEMPOTENT: every movement has a deterministic description
 * ("[DEMO] <section>-<year>-<month>-<n>"); a second run updates the same rows
 * and never duplicates. Month closings are only created when the club has no
 * closing for that month, and are marked with `breakdown.demo = true`, so
 * --cleanup removes only what this script made. Real data is never touched.
 *
 * SAFETY: refuses NODE_ENV=production and any DATABASE_URL that does not
 * contain the Neon DEVELOPMENT endpoint id. The host (no credentials) is
 * printed first.
 */

const DEV_ENDPOINT_ID = 'ep-rough-hill-anztwk76';
const PROD_ENDPOINT_ID = 'ep-dark-thunder-anpobd36';
const DEMO_PREFIX = '[DEMO] ';
const DEFAULT_SECTIONS = [163, 166];
const MAX_SECTIONS = 3;
const CREATOR_ROLES = ['treasurer', 'secretary-treasurer', 'director'];

export interface DemoOptions {
  apply: boolean;
  cleanup: boolean;
  sections: number[];
}

export function parseDemoArgs(args: string[]): DemoOptions {
  const options: DemoOptions = {
    apply: false,
    cleanup: false,
    sections: [...DEFAULT_SECTIONS],
  };
  for (const arg of args) {
    if (arg === '--apply') options.apply = true;
    else if (arg === '--cleanup') options.cleanup = true;
    else if (arg.startsWith('--sections=')) {
      const ids = arg
        .slice('--sections='.length)
        .split(',')
        .map((v) => Number(v.trim()))
        .filter((n) => Number.isInteger(n) && n > 0);
      if (ids.length === 0 || ids.length > MAX_SECTIONS) {
        throw new Error(`--sections needs 1 to ${MAX_SECTIONS} section ids.`);
      }
      options.sections = ids;
    } else throw new Error(`Unknown argument: ${arg}`);
  }
  return options;
}

export interface PlannedMovement {
  sectionId: number;
  year: number;
  month: number;
  index: number;
  description: string;
  /** Position inside the category list of its type. */
  categorySlot: number;
  type: 'income' | 'expense';
  amount: number;
  day: number;
  /** true: created after the month closing (admin late entry). */
  lateEntry: boolean;
}

export interface YearMonth {
  year: number;
  month: number;
}

/** The 3 months before `now` (oldest first) and the current one. */
export function demoMonths(now: Date): {
  past: YearMonth[];
  current: YearMonth;
} {
  const past: YearMonth[] = [];
  for (let back = 3; back >= 1; back -= 1) {
    const d = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - back, 1),
    );
    past.push({ year: d.getUTCFullYear(), month: d.getUTCMonth() + 1 });
  }
  return {
    past,
    current: { year: now.getUTCFullYear(), month: now.getUTCMonth() + 1 },
  };
}

export function demoDescription(
  sectionId: number,
  year: number,
  month: number,
  index: number,
): string {
  return `${DEMO_PREFIX}${sectionId}-${year}-${String(month).padStart(2, '0')}-${index}`;
}

/**
 * Plan per section position (0 = first section, 1 = second, ...):
 *  - position 0: movements in the oldest and middle months, newest past month
 *    EMPTY, current month EMPTY;
 *  - position 1: oldest month EMPTY, middle month with movements plus one late
 *    entry after the closing, newest month with movements, 1 movement now;
 *  - position 2: every past month with movements, current month EMPTY.
 */
export function planDemoMovements(
  sectionIds: number[],
  now: Date,
): PlannedMovement[] {
  const { past, current } = demoMonths(now);
  const plan: PlannedMovement[] = [];

  const add = (
    sectionId: number,
    ym: YearMonth,
    items: Array<
      Omit<
        PlannedMovement,
        'sectionId' | 'year' | 'month' | 'index' | 'description'
      >
    >,
  ) => {
    items.forEach((item, i) =>
      plan.push({
        sectionId,
        year: ym.year,
        month: ym.month,
        index: i + 1,
        description: demoDescription(sectionId, ym.year, ym.month, i + 1),
        ...item,
      }),
    );
  };

  const full = (
    base: number,
  ): Array<
    Omit<
      PlannedMovement,
      'sectionId' | 'year' | 'month' | 'index' | 'description'
    >
  > => [
    {
      type: 'income',
      categorySlot: 0,
      amount: base + 800,
      day: 5,
      lateEntry: false,
    },
    {
      type: 'income',
      categorySlot: 1,
      amount: base + 300,
      day: 12,
      lateEntry: false,
    },
    {
      type: 'expense',
      categorySlot: 0,
      amount: base + 250,
      day: 15,
      lateEntry: false,
    },
    {
      type: 'expense',
      categorySlot: 1,
      amount: base + 90,
      day: 20,
      lateEntry: false,
    },
  ];

  sectionIds.slice(0, MAX_SECTIONS).forEach((sectionId, position) => {
    const base = 100 * (position + 1);
    if (position === 0) {
      add(sectionId, past[0], full(base));
      add(sectionId, past[1], full(base + 50).slice(0, 3));
    } else if (position === 1) {
      add(sectionId, past[1], [
        ...full(base).slice(0, 2),
        {
          type: 'expense',
          categorySlot: 2,
          amount: base + 40,
          day: 18,
          lateEntry: true,
        },
      ]);
      add(sectionId, past[2], full(base + 20));
      add(sectionId, current, full(base).slice(0, 1));
    } else {
      for (const ym of past) add(sectionId, ym, full(base).slice(0, 3));
    }
  });

  return plan;
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

function closedAtOf(ym: YearMonth): Date {
  return new Date(Date.UTC(ym.year, ym.month, 1, 0, 0, 0, 0));
}

async function runDemo(
  prisma: Prisma_,
  options: DemoOptions,
  now: Date,
): Promise<void> {
  const categories = await prisma.finances_categories.findMany({
    where: { active: true },
    select: { finance_category_id: true, name: true, type: true },
    orderBy: [{ type: 'asc' }, { finance_category_id: 'asc' }],
  });
  const incomeCats = categories.filter((c) => c.type === 0);
  const expenseCats = categories.filter((c) => c.type !== 0);
  if (incomeCats.length === 0 || expenseCats.length === 0) {
    throw new Error('Need active income and expense finance categories.');
  }
  const pickCategory = (type: 'income' | 'expense', slot: number) => {
    const list = type === 'income' ? incomeCats : expenseCats;
    return list[slot % list.length];
  };

  const sections = await prisma.club_sections.findMany({
    where: {
      club_section_id: { in: options.sections },
      main_club_id: { not: null },
    },
    select: {
      club_section_id: true,
      club_type_id: true,
      main_club_id: true,
      clubs: { select: { name: true } },
    },
  });
  const sectionById = new Map(sections.map((s) => [s.club_section_id, s]));

  const validSectionIds: number[] = [];
  const creatorBySection = new Map<number, string>();
  for (const sectionId of options.sections) {
    const section = sectionById.get(sectionId);
    if (!section) {
      console.log(
        `- section ${sectionId}: not found (or without club), skipped`,
      );
      continue;
    }
    const creator = await prisma.club_role_assignments.findFirst({
      where: {
        club_section_id: sectionId,
        active: true,
        status: 'active',
        roles: { role_name: { in: CREATOR_ROLES } },
      },
      select: { user_id: true },
      orderBy: { start_date: 'desc' },
    });
    if (!creator) {
      console.log(
        `- section ${sectionId} (${section.clubs?.name ?? '?'}): no treasurer, secretary-treasurer or director, skipped`,
      );
      continue;
    }
    creatorBySection.set(sectionId, creator.user_id);
    validSectionIds.push(sectionId);
  }

  const plan = planDemoMovements(validSectionIds, now);
  const { past } = demoMonths(now);

  let created = 0;
  let updated = 0;
  for (const m of plan) {
    const section = sectionById.get(m.sectionId)!;
    const category = pickCategory(m.type, m.categorySlot);
    const financeDate = new Date(Date.UTC(m.year, m.month - 1, m.day));
    const createdAt = m.lateEntry
      ? new Date(closedAtOf(m).getTime() + 2 * 86_400_000)
      : new Date(Date.UTC(m.year, m.month - 1, m.day, 12, 0, 0));
    const existing = await prisma.finances.findFirst({
      where: { club_section_id: m.sectionId, description: m.description },
      select: { finance_id: true },
    });
    console.log(
      `- ${existing ? 'update' : 'create'} section ${m.sectionId} ${m.year}-${String(m.month).padStart(2, '0')} ` +
        `${m.type} ${m.amount} (${category.name})${m.lateEntry ? ' [after closing]' : ''}`,
    );
    if (existing) updated += 1;
    else created += 1;
    if (!options.apply) continue;

    // The late entry needs the closing to exist first (see below), so it is
    // written in a second pass.
    if (m.lateEntry) continue;
    const data = {
      year: m.year,
      month: m.month,
      amount: m.amount,
      description: m.description,
      club_type_id: section.club_type_id,
      finance_category_id: category.finance_category_id,
      finance_date: financeDate,
      active: true,
      created_by: creatorBySection.get(m.sectionId)!,
      club_section_id: m.sectionId,
      created_at: createdAt,
      modified_at: createdAt,
    };
    if (existing) {
      await prisma.finances.update({
        where: { finance_id: existing.finance_id },
        data,
      });
    } else {
      await prisma.finances.create({ data });
    }
  }

  // Month closings for the past months of the demo clubs (only when missing).
  const clubIds = [
    ...new Set(
      validSectionIds.map((id) => sectionById.get(id)!.main_club_id as number),
    ),
  ];
  let closings = 0;
  for (const clubId of clubIds) {
    for (const ym of past) {
      const existingClosing = await prisma.financePeriodClosing.findUnique({
        where: {
          club_id_year_month: {
            club_id: clubId,
            year: ym.year,
            month: ym.month,
          },
        },
        select: { finance_period_closing_id: true },
      });
      if (existingClosing) continue;
      closings += 1;
      console.log(
        `- create closing club ${clubId} ${ym.year}-${String(ym.month).padStart(2, '0')} (demo)`,
      );
      if (!options.apply) continue;

      const clubSections = await prisma.club_sections.findMany({
        where: { main_club_id: clubId },
        select: { club_section_id: true },
      });
      const sectionIds = clubSections.map((s) => s.club_section_id);
      const rows = await prisma.finances.findMany({
        where: {
          active: true,
          year: ym.year,
          month: ym.month,
          club_section_id: { in: sectionIds },
        },
        select: {
          amount: true,
          club_section_id: true,
          finances_categories: { select: { type: true } },
        },
      });
      let income = 0;
      let expense = 0;
      for (const r of rows) {
        if (r.finances_categories.type === 0) income += r.amount;
        else expense += r.amount;
      }
      await prisma.financePeriodClosing.create({
        data: {
          club_id: clubId,
          year: ym.year,
          month: ym.month,
          total_income: income,
          total_expense: expense,
          balance: income - expense,
          movement_count: rows.length,
          breakdown: { demo: true, by_category: [], by_section: [] },
          closed_at: closedAtOf(ym),
          closed_by: null,
        },
      });
    }
  }

  // Second pass: late entries (created after the closing), with their note.
  if (options.apply) {
    for (const m of plan.filter((p) => p.lateEntry)) {
      const section = sectionById.get(m.sectionId)!;
      const category = pickCategory(m.type, m.categorySlot);
      const createdAt = new Date(closedAtOf(m).getTime() + 2 * 86_400_000);
      const existing = await prisma.finances.findFirst({
        where: { club_section_id: m.sectionId, description: m.description },
        select: { finance_id: true },
      });
      const data = {
        year: m.year,
        month: m.month,
        amount: m.amount,
        description: m.description,
        club_type_id: section.club_type_id,
        finance_category_id: category.finance_category_id,
        finance_date: new Date(Date.UTC(m.year, m.month - 1, m.day)),
        active: true,
        created_by: creatorBySection.get(m.sectionId)!,
        club_section_id: m.sectionId,
        created_at: createdAt,
        modified_at: createdAt,
        post_closing_note: 'Ajuste demo registrado despues del cierre',
      };
      if (existing) {
        await prisma.finances.update({
          where: { finance_id: existing.finance_id },
          data,
        });
      } else {
        await prisma.finances.create({ data });
      }
    }
  }

  console.log(
    options.apply
      ? `Done: ${created} movement(s) created, ${updated} updated, ${closings} closing(s) created.`
      : `Dry-run: ${created} movement(s) to create, ${updated} to update, ${closings} closing(s) to create. Re-run with --apply to write.`,
  );
}

async function runCleanup(
  prisma: Prisma_,
  options: DemoOptions,
): Promise<void> {
  const movementWhere = {
    club_section_id: { in: options.sections },
    description: { startsWith: DEMO_PREFIX },
  };
  const movements = await prisma.finances.count({ where: movementWhere });
  const closings = await prisma.financePeriodClosing.findMany({
    where: { breakdown: { path: ['demo'], equals: true } },
    select: {
      finance_period_closing_id: true,
      club_id: true,
      year: true,
      month: true,
    },
  });
  console.log(
    `- ${movements} demo movement(s) in sections ${options.sections.join(', ')}`,
  );
  for (const c of closings) {
    console.log(
      `- demo closing club ${c.club_id} ${c.year}-${String(c.month).padStart(2, '0')}`,
    );
  }
  if (!options.apply) {
    console.log('Dry-run: nothing deleted. Re-run with --cleanup --apply.');
    return;
  }
  const removed = await prisma.finances.deleteMany({ where: movementWhere });
  const removedClosings = await prisma.financePeriodClosing.deleteMany({
    where: {
      finance_period_closing_id: {
        in: closings.map((c) => c.finance_period_closing_id),
      },
    },
  });
  console.log(
    `Done: ${removed.count} movement(s) and ${removedClosings.count} closing(s) removed.`,
  );
}

async function main(): Promise<void> {
  if (process.env.NODE_ENV === 'production') {
    throw new Error(
      'seed-finances-demo is dev-only; refusing to run (NODE_ENV=production).',
    );
  }
  const options = parseDemoArgs(process.argv.slice(2));

  await import('dotenv/config');
  if (process.env.NODE_ENV === 'production') {
    throw new Error(
      'seed-finances-demo is dev-only; refusing to run (NODE_ENV=production).',
    );
  }
  const host = assertDevDatabase(process.env.DATABASE_URL);
  console.log(`Database host: ${host}`);
  console.log(
    options.apply ? 'Mode: APPLY (writes)' : 'Mode: dry-run (no writes)',
  );

  const { prisma, close } = await createPrisma(
    process.env.DATABASE_URL as string,
  );
  try {
    if (options.cleanup) await runCleanup(prisma, options);
    else await runDemo(prisma, options, new Date());
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
