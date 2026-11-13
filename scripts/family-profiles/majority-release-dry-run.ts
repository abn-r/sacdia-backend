/**
 * majority-release-dry-run.ts
 *
 * Phase 4 (release at majority) checklist tool. Boots the Nest application
 * context and runs the `family-majority-release` cron in DRY-RUN mode: it
 * computes who WOULD be noticed, released, reminded or frozen and WRITES AND
 * SENDS NOTHING. Run it against Neon dev, then staging, and review the report
 * before ever enabling FAMILY_MAJORITY_RELEASE_ENABLED: because the resolver
 * gate is lazy, turning the flag on gates EVERY tracked 18+ person at once.
 *
 * HOW TO RUN
 *   npx tsx scripts/family-profiles/majority-release-dry-run.ts
 *   npx tsx scripts/family-profiles/majority-release-dry-run.ts --only <uuid>
 *
 * Requires DATABASE_URL (loaded from .env). Prints counts by step and by
 * country; uuids only (never a name or an email), one per line with --list.
 * Refuses to run when NODE_ENV=production unless --allow-production is given.
 */
import type {
  MajorityReleaseDryRunItem,
  MajorityReleaseStep,
} from '../../src/guardianships/family-majority-release-cron.service';

export interface DryRunReportArgs {
  only?: string;
  list: boolean;
  allowProduction: boolean;
}

export function parseDryRunArgs(argv: string[]): DryRunReportArgs {
  const args: DryRunReportArgs = { list: false, allowProduction: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--list') args.list = true;
    else if (arg === '--allow-production') args.allowProduction = true;
    else if (arg === '--only') {
      const value = argv[index + 1];
      if (
        !value ||
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
          value,
        )
      ) {
        throw new Error('--only needs a user uuid');
      }
      args.only = value.toLowerCase();
      index += 1;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return args;
}

export interface DryRunReport {
  total: number;
  byStep: Record<MajorityReleaseStep, number>;
  byCountry: Record<string, Record<MajorityReleaseStep, number>>;
  bySource: { cron: number; catchup: number };
}

const emptySteps = (): Record<MajorityReleaseStep, number> => ({
  notice: 0,
  release: 0,
  reminder: 0,
  freeze: 0,
});

/** Aggregates the dry-run items by step and by country (pure, unit tested). */
export function buildDryRunReport(
  items: readonly MajorityReleaseDryRunItem[],
): DryRunReport {
  const report: DryRunReport = {
    total: items.length,
    byStep: emptySteps(),
    byCountry: {},
    bySource: { cron: 0, catchup: 0 },
  };
  for (const item of items) {
    report.byStep[item.step] += 1;
    const country = item.country_id === null ? 'none' : String(item.country_id);
    report.byCountry[country] ??= emptySteps();
    report.byCountry[country][item.step] += 1;
    if (item.step === 'release' && item.source) {
      report.bySource[item.source] += 1;
    }
  }
  return report;
}

async function main(): Promise<void> {
  const args = parseDryRunArgs(process.argv.slice(2));
  if (process.env.NODE_ENV === 'production' && !args.allowProduction) {
    throw new Error(
      'majority-release-dry-run refuses to run in production without --allow-production.',
    );
  }
  await import('dotenv/config');

  const { NestFactory } = await import('@nestjs/core');
  const { AppModule } = await import('../../src/app.module.js');
  const { FamilyMajorityReleaseCronService } =
    await import('../../src/guardianships/family-majority-release-cron.service.js');
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: false,
  });
  try {
    const cron = app.get(FamilyMajorityReleaseCronService);
    const { summary, items } = await cron.run(new Date(), {
      dryRun: true,
      onlyDependentId: args.only,
    });
    console.log(
      JSON.stringify({ summary, report: buildDryRunReport(items) }, null, 2),
    );
    if (args.list) {
      for (const item of items) {
        console.log(
          `${item.step}\t${item.user_id}\t${item.majorityDate ?? '-'}\t${item.source ?? '-'}`,
        );
      }
    }
  } finally {
    await app.close();
  }
}

if (process.argv[1]?.includes('majority-release-dry-run')) {
  void main().catch((error: unknown) => {
    console.error(
      `majority release dry run aborted: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
    process.exitCode = 1;
  });
}
