// Shared queue identifiers + job data types for the finance-period BullMQ
// pipeline. Extracted to a neutral file so finance-period.service.ts and
// finance-period.processor.ts can both import without forming a runtime
// circular dependency.

export const FINANCE_PERIOD_QUEUE = 'finance-period';

export interface FinancePeriodTriggerJobData {
  triggeredAt: string; // ISO string
  year: number;
  month: number;
}
