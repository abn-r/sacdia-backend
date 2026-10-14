import type { Logger } from '@nestjs/common';
import type { Worker } from 'bullmq';
import {
  DedupedErrorLogger,
  redisErrorHint,
} from '../common/observability/deduped-error-logger';

/**
 * Routes a worker's `error` events through a per-worker deduplicating logger.
 *
 * BullMQ re-emits the same Redis error every ~100 ms while Redis is down or
 * over quota (the wait loop retries after a 100 ms delay), so without this
 * each worker writes ~10 lines per second. Registering a listener also keeps
 * the event from becoming an unhandled 'error' that would crash the process.
 *
 * The first occurrence is logged immediately; repeats are collapsed into one
 * line per exponentially growing window (30 s up to 10 min) that reports how
 * many were suppressed.
 */
export function attachBullmqWorkerErrorLogging(
  worker: Pick<Worker, 'on'>,
  workerLogger: Pick<Logger, 'error'>,
  queue: string,
  deduped: DedupedErrorLogger = new DedupedErrorLogger(workerLogger),
): void {
  worker.on('error', (error: Error) => {
    deduped.log(
      `BullMQ worker error (queue "${queue}")`,
      error,
      redisErrorHint(error),
    );
  });
}
