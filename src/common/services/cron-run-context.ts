import { AsyncLocalStorage } from 'node:async_hooks';
import { Prisma } from '@prisma/client';

/**
 * Ambient context of an on-demand ("Ejecutar ahora") cron run.
 *
 * A super-admin triggers a scheduled job through the same handler the
 * `@Cron` decorator invokes. The handlers know nothing about who called them,
 * so the trigger travels in an AsyncLocalStorage: `CronRunLogger` reads it to
 * mark the `cron_run_log` row (`trigger: 'manual'`) and to report back the
 * outcome of the run. Scheduled runs never have a context, so their rows are
 * written exactly as before.
 */

export type CronRunStatus = 'completed' | 'failed' | 'skipped';

export interface CronRunOutcome {
  runId: number;
  status: CronRunStatus;
  itemsProcessed: number | null;
  errorMessage: string | null;
  durationMs: number | null;
}

export interface ManualCronContext {
  /** user_id of the super-admin that triggered the run. */
  triggeredBy: string;
  /** Filled by CronRunLogger, one entry per cron_run_log row written. */
  outcomes: CronRunOutcome[];
}

/** Key carried in BullMQ payloads so the worker can mark its own run. */
export interface ManualTriggerPayload {
  manualTriggeredBy?: string;
}

const storage = new AsyncLocalStorage<ManualCronContext>();

export function runWithManualCronContext<T>(
  context: ManualCronContext,
  fn: () => Promise<T>,
): Promise<T> {
  return storage.run(context, fn);
}

export function getManualCronContext(): ManualCronContext | undefined {
  return storage.getStore();
}

/** Metadata to merge into a manual run; `{}` for a scheduled run. */
export function manualRunMetadata(): Record<string, string> {
  const context = getManualCronContext();
  return context
    ? { trigger: 'manual', triggered_by: context.triggeredBy }
    : {};
}

/**
 * Merges the manual-run marker into the metadata a job already passes.
 * Returns the metadata untouched (JsonNull when absent) for scheduled runs.
 */
export function withManualMetadata(
  meta?: Prisma.InputJsonValue,
): Prisma.InputJsonValue | typeof Prisma.JsonNull {
  const marker = manualRunMetadata();
  if (Object.keys(marker).length === 0) {
    return meta ?? Prisma.JsonNull;
  }
  if (meta === undefined) {
    return marker;
  }
  if (typeof meta === 'object' && meta !== null && !Array.isArray(meta)) {
    return { ...meta, ...marker };
  }
  return { ...marker, scheduled_metadata: meta };
}

export function recordCronOutcome(outcome: CronRunOutcome): void {
  getManualCronContext()?.outcomes.push(outcome);
}

/**
 * Handlers that hand the work to BullMQ call this to put the trigger in the
 * job payload (the worker runs outside this async context).
 */
export function manualTriggerPayload(): ManualTriggerPayload {
  const context = getManualCronContext();
  return context ? { manualTriggeredBy: context.triggeredBy } : {};
}

/** Worker side of {@link manualTriggerPayload}. */
export function runWithManualTriggerFromPayload<T>(
  payload: ManualTriggerPayload,
  fn: () => Promise<T>,
): Promise<T> {
  if (!payload.manualTriggeredBy) {
    return fn();
  }
  return runWithManualCronContext(
    { triggeredBy: payload.manualTriggeredBy, outcomes: [] },
    fn,
  );
}
