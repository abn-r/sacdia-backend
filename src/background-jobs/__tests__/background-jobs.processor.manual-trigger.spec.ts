import { Job } from 'bullmq';
import { BackgroundJobsProcessor } from '../background-jobs.processor';
import { BackgroundJobName } from '../background-jobs.types';
import { getManualCronContext } from '../../common/services/cron-run-context';
import type { MonthlyReportsService } from '../../monthly-reports/monthly-reports.service';
import type { FinancePeriodService } from '../../finances/finance-period.service';
import type { RankingsService } from '../../annual-folders/rankings.service';
import type { DataExportService } from '../../data-export/data-export.service';
import type { CronRunLogger } from '../../common/services/cron-run-logger.service';

/**
 * An on-demand ("Ejecutar ahora") run of a queue-backed cron puts the actor in
 * the job payload; the worker must re-establish the manual context so the
 * cron_run_log row it writes is marked trigger=manual.
 */
describe('BackgroundJobsProcessor — manual trigger hand-off', () => {
  const seen: Array<string | undefined> = [];
  const record = () => {
    seen.push(getManualCronContext()?.triggeredBy);
  };

  const monthlyReports = {
    runAutoGeneration: jest.fn(() => {
      record();
      return Promise.resolve({ itemsProcessed: 1 });
    }),
  };
  const financePeriod = {
    runMonthlyClosing: jest.fn(() => {
      record();
      return Promise.resolve({ itemsProcessed: 1 });
    }),
  };
  const rankings = {
    recalculateRankings: jest.fn(() => {
      record();
      return Promise.resolve({ updated: 1 });
    }),
    recalculateAll: jest.fn(),
  };
  const cronLogger = {
    track: jest.fn(<T>(_name: string, fn: () => Promise<T>) => fn()),
    trackSkipped: jest.fn(),
  };

  let processor: BackgroundJobsProcessor;

  const job = (name: BackgroundJobName, data: Record<string, unknown>) =>
    ({
      id: 'job-1',
      name,
      data,
      attemptsMade: 0,
      opts: { attempts: 5 },
    }) as unknown as Job<unknown>;

  beforeEach(() => {
    jest.clearAllMocks();
    seen.length = 0;
    processor = new BackgroundJobsProcessor(
      monthlyReports as unknown as MonthlyReportsService,
      financePeriod as unknown as FinancePeriodService,
      rankings as unknown as RankingsService,
      {} as unknown as DataExportService,
      cronLogger as unknown as CronRunLogger,
    );
  });

  it.each([
    [
      'monthly reports auto-generate',
      BackgroundJobName.MONTHLY_REPORTS_AUTO_GENERATE,
      {},
    ],
    [
      'finance period close',
      BackgroundJobName.FINANCE_PERIOD_CLOSE_MONTH,
      { year: 2026, month: 9 },
    ],
    ['rankings recalculate', BackgroundJobName.RANKINGS_RECALCULATE, {}],
  ])(
    '%s runs inside the manual context when the payload carries the actor',
    async (_label, name, extra) => {
      await processor.process(
        job(name, {
          triggeredAt: '2026-10-21T00:00:00.000Z',
          manualTriggeredBy: 'admin-1',
          ...extra,
        }),
      );

      expect(seen).toEqual(['admin-1']);
    },
  );

  it.each([
    [
      'monthly reports auto-generate',
      BackgroundJobName.MONTHLY_REPORTS_AUTO_GENERATE,
      {},
    ],
    [
      'finance period close',
      BackgroundJobName.FINANCE_PERIOD_CLOSE_MONTH,
      { year: 2026, month: 9 },
    ],
    ['rankings recalculate', BackgroundJobName.RANKINGS_RECALCULATE, {}],
  ])(
    '%s stays a scheduled run when the payload has no actor',
    async (_label, name, extra) => {
      await processor.process(
        job(name, { triggeredAt: '2026-10-21T00:00:00.000Z', ...extra }),
      );

      expect(seen).toEqual([undefined]);
    },
  );
});
