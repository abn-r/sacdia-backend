import 'dotenv/config';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';

import {
  applyMasterHonorRulesImport,
  parseMasterHonorRulesImportDocument,
  summarizeMasterHonorRulesImport,
} from '../src/honors/master-honor-rule-importer';

function printUsage(): void {
  console.log(`
Usage:
  pnpm exec tsx scripts/import-master-honor-rules.ts --file <path> [--apply] [--allow-create]
  pnpm exec tsx scripts/import-master-honor-rules.ts --dry-run

Environment:
  MASTER_HONOR_IMPORT_DATABASE_URL  Optional. Overrides DATABASE_URL.
  DATABASE_URL                      Used when the override is not set.

Options:
  --file <path>    JSON source file with official curated master honor rules.
  --apply          Persist changes. Omit for dry-run.
  --allow-create   Allow creating missing master_honors. Use only after manual review.
  --dry-run        Without --file, prints the expected JSON contract and exits.
  --help           Show this help.

Safety:
  - Default mode is dry-run.
  - The importer never writes users_master_honors or evaluation history.
  - Do not infer requirements from honors.master_honors_id.
  - Use applicability_scope = "SELECTED_DIVISIONS" only when division_ids is not empty.
  - After --apply, recalculate affected master honors through the admin endpoint or queue.
`);
}

function getArg(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  if (index === -1) return undefined;
  return process.argv[index + 1];
}

function hasFlag(flag: string): boolean {
  return process.argv.includes(flag);
}

function printExpectedContract(): void {
  console.log(
    JSON.stringify(
      {
        version: '2026.official-draft',
        master_honors: [
          {
            master_honor_id: 2,
            name: 'Maestría en Acuática',
            master_image: null,
            active: true,
            philosophy:
              'Las especialidades de esta maestría enfatizan la recreación acuática.',
            notes: 'Notas oficiales opcionales.',
            applicability_scope: 'ALL',
            division_ids: [],
            groups: [
              {
                group_type: 'EXPLICIT_OPTIONS',
                title: 'Lista oficial',
                description: null,
                minimum_required: 1,
                display_order: 0,
                active: true,
                options: [
                  {
                    label: 'Natación III',
                    display_order: 0,
                    active: true,
                    honor_ids: [10, 11],
                  },
                ],
              },
              {
                group_type: 'CATEGORY_COUNT',
                title: 'Categoría oficial',
                description: null,
                minimum_required: 7,
                honors_category_id: 4,
                display_order: 1,
                active: true,
              },
            ],
          },
        ],
      },
      null,
      2,
    ),
  );
}

async function readSourceFile(filePath: string): Promise<{
  checksum: string;
  parsed: unknown;
}> {
  const raw = await fs.readFile(filePath, 'utf8');
  return {
    checksum: `sha256:${crypto.createHash('sha256').update(raw).digest('hex')}`,
    parsed: JSON.parse(raw) as unknown,
  };
}

function createPrismaClient(): { prisma: PrismaClient; pool: Pool } {
  const databaseUrl =
    process.env.MASTER_HONOR_IMPORT_DATABASE_URL ?? process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error('Missing DATABASE_URL or MASTER_HONOR_IMPORT_DATABASE_URL');
  }

  const pool = new Pool({ connectionString: databaseUrl });
  const adapter = new PrismaPg(pool);
  return {
    prisma: new PrismaClient({ adapter }),
    pool,
  };
}

async function main(): Promise<void> {
  if (hasFlag('--help') || hasFlag('-h')) {
    printUsage();
    return;
  }

  const filePath = getArg('--file');
  const apply = hasFlag('--apply');
  const allowCreate = hasFlag('--allow-create');

  if (!filePath) {
    if (hasFlag('--dry-run') || !apply) {
      printUsage();
      console.log('\nExpected JSON contract:');
      printExpectedContract();
      return;
    }
    throw new Error('--file is required when using --apply');
  }

  const { checksum, parsed } = await readSourceFile(filePath);
  const document = parseMasterHonorRulesImportDocument(parsed);

  if (!apply) {
    console.log('Parsed source summary:');
    console.log(
      JSON.stringify(
        { checksum, ...summarizeMasterHonorRulesImport(document) },
        null,
        2,
      ),
    );
  }

  const { prisma, pool } = createPrismaClient();
  try {
    const result = await applyMasterHonorRulesImport(prisma, document, {
      apply,
      allowCreate,
    });
    console.log(
      JSON.stringify(
        {
          checksum,
          ...result,
          note: 'After apply, recalculate affected master honors through POST /api/v1/admin/master-honors/:id/recalculate or the master-honors queue. This importer does not mutate users_master_honors.',
        },
        null,
        2,
      ),
    );
  } finally {
    await prisma.$disconnect();
    await pool.end();
  }
}

main().catch((error) => {
  console.error('Master honor rules import failed:', error);
  process.exitCode = 1;
});
