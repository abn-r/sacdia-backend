// Shared queue identifiers + job data types for the rankings BullMQ pipeline.
// Extracted to a neutral file so rankings.service.ts and rankings.processor.ts
// can both import without forming a runtime circular dependency.

export const RANKINGS_QUEUE = 'rankings';

export interface RankingsTriggerJobData {
  triggeredAt: string; // ISO string
}
