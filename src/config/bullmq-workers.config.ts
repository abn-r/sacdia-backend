import { Logger } from '@nestjs/common';
import type { WorkerOptions } from 'bullmq';

/**
 * Central BullMQ worker configuration.
 *
 * Why this exists: every BullMQ worker polls Redis even when idle (a blocking
 * BZPOPMIN plus a moveToActive script per `drainDelay`, and a stalled-jobs
 * script per `stalledInterval`). BullMQ 5.81 defaults are drainDelay=5 s and
 * stalledInterval=30 s, which costs ~26 commands/min per worker. With 6
 * workers that alone exceeds the Upstash free tier (500k commands/month).
 *
 * Everything here is read from `process.env` at call time. `@Processor()`
 * decorators evaluate at module load, so `main.ts` must load dotenv first
 * (same constraint as `isRedisConfigured()` in the queue modules).
 */

/** Canonical list of queues that own a worker in this process. */
export const BULLMQ_WORKER_QUEUES = [
  'notifications',
  'achievements',
  'emails',
  'background-jobs',
  'master-honors',
  'certificate-import-ocr',
] as const;

export type BullmqWorkerQueue = (typeof BULLMQ_WORKER_QUEUES)[number];

export const BULLMQ_DEFAULT_DRAIN_DELAY_SECONDS = 30;
export const BULLMQ_DEFAULT_STALLED_INTERVAL_MS = 300_000;
/** BullMQ's own default; stalledInterval is never allowed below lockDuration. */
export const BULLMQ_DEFAULT_LOCK_DURATION_MS = 30_000;

/**
 * Queues whose jobs run long enough to need a bigger lock than BullMQ's 30 s
 * default (OCR: PDF validation + vendor call with a 40 s timeout).
 */
const LOCK_DURATION_MS_BY_QUEUE: Partial<Record<BullmqWorkerQueue, number>> = {
  'certificate-import-ocr': 60_000,
};

type Env = Record<string, string | undefined>;

const logger = new Logger('BullmqWorkers');
const reportedDisabled = new Set<string>();

function parseBoolean(value: string | undefined, fallback: boolean): boolean {
  const normalized = value?.trim().toLowerCase();
  if (normalized === 'true' || normalized === '1') return true;
  if (normalized === 'false' || normalized === '0') return false;
  return fallback;
}

function parsePositiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number(value?.trim());
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

export function parseQueueList(value: string | undefined): string[] {
  return (value ?? '')
    .split(',')
    .map((name) => name.trim())
    .filter((name) => name.length > 0);
}

/**
 * Whether the worker for `queue` should be created in this process.
 *
 * Disabled workers are simply not registered as providers: producers
 * (`Queue.add`) keep working, but nothing consumes the queue here, so jobs
 * stay `waiting` until a process with the worker enabled picks them up.
 */
export function isBullmqWorkerEnabled(
  queue: BullmqWorkerQueue,
  env: Env = process.env,
): boolean {
  const globallyEnabled = parseBoolean(env.BULLMQ_WORKERS_ENABLED, true);
  const disabledQueues = parseQueueList(env.BULLMQ_DISABLED_QUEUES);
  const enabled = globallyEnabled && !disabledQueues.includes(queue);

  if (!enabled && !reportedDisabled.has(queue)) {
    reportedDisabled.add(queue);
    logger.warn(
      `BullMQ worker for queue "${queue}" is disabled by configuration; jobs enqueued in this process will not be consumed here.`,
    );
  }

  return enabled;
}

/**
 * Worker options with cheap idle polling. `overrides` wins over the computed
 * values (concurrency, limiter, ...), except that `stalledInterval` is always
 * clamped to at least the effective `lockDuration`.
 */
export function buildBullmqWorkerOptions(
  queue: BullmqWorkerQueue,
  overrides: Partial<WorkerOptions> = {},
  env: Env = process.env,
): Partial<WorkerOptions> {
  const lockDuration =
    overrides.lockDuration ??
    LOCK_DURATION_MS_BY_QUEUE[queue] ??
    BULLMQ_DEFAULT_LOCK_DURATION_MS;

  const drainDelay = parsePositiveInt(
    env.BULLMQ_WORKER_DRAIN_DELAY_SECONDS,
    BULLMQ_DEFAULT_DRAIN_DELAY_SECONDS,
  );
  const configuredStalledInterval = parsePositiveInt(
    env.BULLMQ_WORKER_STALLED_INTERVAL_MS,
    BULLMQ_DEFAULT_STALLED_INTERVAL_MS,
  );

  return {
    drainDelay,
    lockDuration,
    ...overrides,
    stalledInterval: Math.max(
      overrides.stalledInterval ?? configuredStalledInterval,
      lockDuration,
    ),
  };
}
