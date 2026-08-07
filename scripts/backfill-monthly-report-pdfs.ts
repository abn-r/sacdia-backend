import 'dotenv/config';

import { MONTHLY_REPORT_PDF_TEMPLATE_VERSION } from '../src/monthly-reports/monthly-report-artifact.constants';
import type { MonthlyReportArtifactsService } from '../src/monthly-reports/monthly-report-artifacts.service';

const DEFAULT_BATCH_SIZE = 25;
const MAX_BATCH_SIZE = 500;

export type BackfillReportCandidate = {
  monthly_report_id: string;
  status: 'generated' | 'submitted' | string;
  snapshot_data: unknown;
  pdf_r2_key: string | null;
  pdf_size_bytes: bigint | number | null;
  pdf_sha256: string | null;
  pdf_generated_at: Date | null;
  pdf_template_version: string | null;
};

export type BackfillOptions = {
  apply: boolean;
  dryRun: boolean;
  batchSize: number;
  limit?: number;
  cursor?: string;
  shouldStop?: () => boolean;
};

export type BackfillResult = {
  selected: number;
  processed: number;
  generated: number;
  skipped: number;
  failed: number;
  nextCursor?: string;
  stopped: boolean;
};

export type BackfillLogger = {
  info: (...args: unknown[]) => void;
  error: (...args: unknown[]) => void;
};

export type BackfillDependencies = {
  prisma: {
    monthly_reports: {
      findMany: (
        args: Record<string, unknown>,
      ) => Promise<BackfillReportCandidate[]>;
    };
  };
  artifacts: Pick<MonthlyReportArtifactsService, 'ensureCurrentArtifact'>;
  logger?: BackfillLogger;
};

type InternalDependencies = BackfillDependencies & {
  shouldStop?: () => boolean;
};

export class BackfillUsageError extends Error {
  constructor() {
    super('BACKFILL_USAGE');
  }
}

function parsePositiveInteger(value: string | undefined): number {
  if (!value || !/^\d+$/.test(value)) throw new BackfillUsageError();
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1) {
    throw new BackfillUsageError();
  }
  return parsed;
}

export function parseBackfillOptions(args: string[]): BackfillOptions {
  let apply = false;
  let dryRun = true;
  let batchSize = DEFAULT_BATCH_SIZE;
  let limit: number | undefined;
  let cursor: string | undefined;

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === '--apply') {
      if (apply || !dryRun) throw new BackfillUsageError();
      apply = true;
      dryRun = false;
      continue;
    }
    if (argument === '--dry-run') {
      if (apply) throw new BackfillUsageError();
      dryRun = true;
      continue;
    }
    if (argument === '--batch-size') {
      batchSize = parsePositiveInteger(args[++index]);
      if (batchSize > MAX_BATCH_SIZE) throw new BackfillUsageError();
      continue;
    }
    if (argument === '--limit') {
      limit = parsePositiveInteger(args[++index]);
      continue;
    }
    if (argument === '--cursor') {
      cursor = args[++index];
      if (!cursor) throw new BackfillUsageError();
      continue;
    }
    throw new BackfillUsageError();
  }

  return { apply, dryRun, batchSize, limit, cursor };
}

export function printUsage(): void {
  console.log(`
Usage:
  pnpm reports:backfill-pdfs -- --dry-run [--batch-size 25] [--limit 100]
  pnpm reports:backfill-pdfs -- --apply [--batch-size 25] [--limit 100] [--cursor <monthly_report_id>]

Options:
  --dry-run       Show candidates without rendering, uploading or updating (default).
  --apply         Render and persist artifacts; required for any writes.
  --batch-size N  Number of records read per cursor page (1-${MAX_BATCH_SIZE}).
  --limit N       Maximum number of records selected in this invocation.
  --cursor ID     Resume after this monthly_report_id.
  --help          Show this help.

Safety:
  - The script never writes unless --apply is explicit.
  - Objects use the canonical private R2 key and overwrite semantics from MonthlyReportArtifactsService.
  - Logs contain report IDs and artifact metadata only; never signed URLs or report contents.
`);
}

function selectionArgs(take: number, cursor?: string): Record<string, unknown> {
  return {
    where: {
      status: { in: ['generated', 'submitted'] },
      OR: [
        { pdf_r2_key: null },
        { pdf_template_version: null },
        { pdf_template_version: { not: MONTHLY_REPORT_PDF_TEMPLATE_VERSION } },
      ],
    },
    orderBy: { monthly_report_id: 'asc' },
    select: {
      monthly_report_id: true,
      status: true,
      snapshot_data: true,
      pdf_r2_key: true,
      pdf_size_bytes: true,
      pdf_sha256: true,
      pdf_generated_at: true,
      pdf_template_version: true,
    },
    take,
    ...(cursor ? { cursor: { monthly_report_id: cursor }, skip: 1 } : {}),
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'unknown_error';
}

export async function runBackfill(
  dependencies: InternalDependencies,
  options: BackfillOptions,
): Promise<BackfillResult> {
  const logger = dependencies.logger ?? console;
  const shouldStop =
    dependencies.shouldStop ?? options.shouldStop ?? (() => false);
  const result: BackfillResult = {
    selected: 0,
    processed: 0,
    generated: 0,
    skipped: 0,
    failed: 0,
    stopped: false,
  };
  let cursor = options.cursor;

  while (options.limit === undefined || result.selected < options.limit) {
    if (shouldStop()) {
      result.stopped = true;
      break;
    }

    const remaining =
      options.limit === undefined
        ? options.batchSize
        : Math.min(options.batchSize, options.limit - result.selected);
    const candidates = await dependencies.prisma.monthly_reports.findMany(
      selectionArgs(remaining, cursor),
    );
    if (candidates.length === 0) break;

    for (const candidate of candidates) {
      result.selected += 1;
      result.nextCursor = candidate.monthly_report_id;

      if (options.dryRun) {
        result.skipped += 1;
        logger.info(
          `[dry-run] monthly report ${candidate.monthly_report_id} would be rendered and stored`,
        );
      } else if (!options.apply) {
        throw new BackfillUsageError();
      } else {
        result.processed += 1;
        try {
          const artifact = await dependencies.artifacts.ensureCurrentArtifact(
            candidate.monthly_report_id,
          );
          result.generated += 1;
          logger.info(
            `generated monthly report PDF reportId=${artifact.reportId} key=${artifact.key} template=${artifact.templateVersion} bytes=${artifact.sizeBytes} sha256_prefix=${artifact.sha256.slice(0, 12)}`,
          );
        } catch (error) {
          result.failed += 1;
          logger.error(
            `failed monthly report PDF reportId=${candidate.monthly_report_id}`,
            errorMessage(error),
          );
        }
      }

      if (shouldStop()) {
        result.stopped = true;
        break;
      }
      if (options.limit !== undefined && result.selected >= options.limit)
        break;
    }

    if (
      result.stopped ||
      (options.limit !== undefined && result.selected >= options.limit)
    ) {
      break;
    }
    cursor = result.nextCursor;
    if (candidates.length < remaining) break;
  }

  logger.info(
    `monthly report PDF backfill summary selected=${result.selected} processed=${result.processed} generated=${result.generated} skipped=${result.skipped} failed=${result.failed}${result.nextCursor ? ` nextCursor=${result.nextCursor}` : ''}${result.stopped ? ' stopped=true' : ''}`,
  );
  return result;
}

export async function main(args = process.argv.slice(2)): Promise<void> {
  if (args.includes('--help') || args.includes('-h')) {
    printUsage();
    return;
  }

  const options = parseBackfillOptions(args);
  let stopRequested = false;
  const onSigint = () => {
    stopRequested = true;
    console.warn(
      'SIGINT received; finishing the current report before stopping.',
    );
  };
  process.once('SIGINT', onSigint);

  const { NestFactory } = await import('@nestjs/core');
  const { AppModule } = await import('../src/app.module.js');
  const { MonthlyReportArtifactsService } =
    await import('../src/monthly-reports/monthly-report-artifacts.service.js');
  const { PrismaService } = await import('../src/prisma/prisma.service.js');
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: false,
  });
  try {
    await runBackfill(
      {
        prisma: app.get(PrismaService),
        artifacts: app.get(MonthlyReportArtifactsService),
        shouldStop: () => stopRequested,
      },
      options,
    );
  } finally {
    process.removeListener('SIGINT', onSigint);
    await app.close();
  }
}

if (process.argv[1]?.includes('backfill-monthly-report-pdfs')) {
  void main().catch((error: unknown) => {
    console.error(
      `monthly report PDF backfill aborted: ${errorMessage(error)}`,
    );
    process.exitCode = 1;
  });
}
