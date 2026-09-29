import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import pg from 'pg';
import { AuthorizationContextService } from '../src/common/services/authorization-context.service';
import { CronRunLogger } from '../src/common/services/cron-run-logger.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { FinancePeriodService } from '../src/finances/finance-period.service';

async function main() {
  const apply = process.argv.includes('--apply');
  const connectionString =
    process.env.DATABASE_DIRECT_URL ?? process.env.DATABASE_URL;

  if (!connectionString) {
    throw new Error('DATABASE_DIRECT_URL or DATABASE_URL is required');
  }

  const pool = new pg.Pool({ connectionString });
  const adapter = new PrismaPg(pool);
  const prisma = new PrismaClient({ adapter });

  const service = new FinancePeriodService(
    prisma as unknown as PrismaService,
    {
      hasAnyGlobalRole: async () => false,
    } as unknown as AuthorizationContextService,
    {
      track: async (_name: string, fn: () => Promise<unknown>) => fn(),
      trackSkipped: async () => undefined,
    } as unknown as CronRunLogger,
    null,
  );

  try {
    if (!apply) {
      console.log(
        'Dry run. Re-run with --apply to rebuild completed UTC months.',
      );
      process.exit(0);
    }

    const result = await service.rebuildCompletedClosings();
    console.log(JSON.stringify(result, null, 2));
  } finally {
    await prisma.$disconnect();
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
