/**
 * Shared type definitions for the consolidated background-jobs BullMQ queue.
 *
 * All low-priority, non-notification, non-achievement background work is
 * funnelled through a single `background-jobs` queue so that Redis admin
 * tooling, analytics, and processor registration stay cohesive.
 */

export const BACKGROUND_JOBS_QUEUE = 'background-jobs';

/**
 * Discriminated job-name constants.
 * Using a const-object pattern so TypeScript can narrow on `job.name` in
 * switch statements while also exporting a union type for exhaustiveness checks.
 */
export const BackgroundJobName = {
  MONTHLY_REPORTS_AUTO_GENERATE: 'monthly-reports.auto-generate',
  FINANCE_PERIOD_CLOSE_MONTH: 'finance-period.close-month',
  RANKINGS_RECALCULATE: 'rankings.recalculate',
  DATA_EXPORT_GENERATE: 'data-export.generate',
} as const;

export type BackgroundJobName =
  (typeof BackgroundJobName)[keyof typeof BackgroundJobName];

// ---------------------------------------------------------------------------
// Per-job payload interfaces
// ---------------------------------------------------------------------------

export interface MonthlyReportsAutoGeneratePayload {
  triggeredAt: string; // ISO 8601
}

export interface FinancePeriodCloseMonthPayload {
  triggeredAt: string; // ISO 8601
  year: number;
  month: number;
}

export interface RankingsRecalculatePayload {
  triggeredAt: string; // ISO 8601
}

export interface DataExportGeneratePayload {
  exportId: string;
  userId: string;
}

// ---------------------------------------------------------------------------
// Discriminated-union payload map — allows typed job.data per job.name
// ---------------------------------------------------------------------------

export type BackgroundJobPayloadMap = {
  [BackgroundJobName.MONTHLY_REPORTS_AUTO_GENERATE]: MonthlyReportsAutoGeneratePayload;
  [BackgroundJobName.FINANCE_PERIOD_CLOSE_MONTH]: FinancePeriodCloseMonthPayload;
  [BackgroundJobName.RANKINGS_RECALCULATE]: RankingsRecalculatePayload;
  [BackgroundJobName.DATA_EXPORT_GENERATE]: DataExportGeneratePayload;
};

// ---------------------------------------------------------------------------
// CronRunLogger key mapping
// data-export is NOT a cron job, so it has no cron key.
// ---------------------------------------------------------------------------

export const MAP_JOB_TO_CRON_KEY: Partial<Record<BackgroundJobName, string>> = {
  [BackgroundJobName.MONTHLY_REPORTS_AUTO_GENERATE]:
    'monthly-reports-auto-generate',
  [BackgroundJobName.FINANCE_PERIOD_CLOSE_MONTH]: 'finance-period-closing',
  [BackgroundJobName.RANKINGS_RECALCULATE]: 'rankings-recalculate',
};
