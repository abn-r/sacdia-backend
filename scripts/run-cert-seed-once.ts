// One-off runner: seeds only the basic pathfinder staff training certification.
// Usage: DATABASE_URL=<direct-url> npx tsx scripts/run-cert-seed-once.ts
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import pg from 'pg';
import { seedBasicPathfinderStaffTraining } from '../prisma/seeds/certifications/basic-pathfinder-staff-training.seed';

async function main() {
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  const adapter = new PrismaPg(pool);
  const prisma = new PrismaClient({ adapter });
  try {
    const report = await prisma.$transaction(
      (tx) => seedBasicPathfinderStaffTraining(tx),
      { timeout: 300_000, maxWait: 30_000 },
    );
    console.log(JSON.stringify(report, null, 2));
  } finally {
    await prisma.$disconnect();
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
