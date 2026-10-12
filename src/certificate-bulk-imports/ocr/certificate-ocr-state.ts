import type { Logger } from '@nestjs/common';
import type { Queue } from 'bullmq';
import { certificateOcrJobId } from './certificate-ocr.queue';

/**
 * Public OCR read state of a batch (plan D3, section 4.6). Derived, never
 * stored. `null` means OCR was never requested for the batch.
 */
export type CertificateOcrState =
  'pending' | 'running' | 'done' | 'empty' | 'failed';

/**
 * A job gone from Redis whose `OCR_QUEUED` event has no `OCR_PROCESSED` is
 * `pending` while it is younger than this (covers the gap between `add()` and
 * the event row) and `failed` after it (the failed job aged out of Redis).
 */
export const OCR_ORPHAN_QUEUED_MAX_AGE_MS = 5 * 60 * 1000;

type OcrEventLike = {
  action: string;
  created_at: Date | string;
  payload?: unknown;
};

type OcrJobLookup = Pick<Queue, 'getJob'>;

const LIVE_WAITING_STATES = new Set([
  'waiting',
  'delayed',
  'prioritized',
  'waiting-children',
]);

/** Jobs a retry must not duplicate: queued or being read right now. */
export function isLiveOcrJobState(state: string | null | undefined): boolean {
  return state === 'active' || LIVE_WAITING_STATES.has(state ?? '');
}

function latest(events: readonly OcrEventLike[], action: string) {
  let found: { at: number; event: OcrEventLike } | null = null;
  for (const event of events) {
    if (event.action !== action) continue;
    const at = new Date(event.created_at).getTime();
    if (!found || at >= found.at) found = { at, event };
  }
  return found;
}

function itemCount(payload: unknown): number {
  const count = (payload as { item_count?: unknown } | null)?.item_count;
  return typeof count === 'number' ? count : 0;
}

/**
 * Event half of the derivation. Returns the final state when the events alone
 * decide it (`null`, `done`, `empty`), or `'job'` when the live job must be
 * consulted.
 */
function fromEvents(
  events: readonly OcrEventLike[],
): null | 'done' | 'empty' | 'job' {
  const queued = latest(events, 'OCR_QUEUED');
  if (!queued) return null;
  const processed = latest(events, 'OCR_PROCESSED');
  if (processed && processed.at >= queued.at) {
    return itemCount(processed.event.payload) > 0 ? 'done' : 'empty';
  }
  return 'job';
}

/**
 * Pure derivation. Precedence, first match wins:
 * 1. No `OCR_QUEUED` event: `null` (never requested).
 * 2. `OCR_PROCESSED` at or after the latest `OCR_QUEUED`: `done` (items > 0) or
 *    `empty`. The event is the source of truth because a successful job is
 *    deleted (`removeOnComplete`). A re-run queued after an old result does
 *    not match this rule, so the old result never masks the new read.
 * 3. Live job: `active` is `running`; `waiting`/`delayed`/... is `pending`
 *    (includes the backoff between attempts); `failed` is `failed`.
 * 4. No usable job (absent, `completed` without event, `unknown`): `failed`
 *    if the latest `OCR_QUEUED` is older than 5 minutes, else `pending`.
 *
 * `jobState` is the BullMQ state, or `null` when the job does not exist.
 */
export function deriveOcrState(
  events: readonly OcrEventLike[],
  jobState: string | null,
  now: Date = new Date(),
): CertificateOcrState | null {
  const decided = fromEvents(events);
  if (decided !== 'job') return decided;
  if (jobState === 'active') return 'running';
  if (LIVE_WAITING_STATES.has(jobState ?? '')) return 'pending';
  if (jobState === 'failed') return 'failed';
  const queued = latest(events, 'OCR_QUEUED');
  const age = now.getTime() - (queued?.at ?? now.getTime());
  return age > OCR_ORPHAN_QUEUED_MAX_AGE_MS ? 'failed' : 'pending';
}

/**
 * Resolves `ocr_state` from the batch events already loaded by the caller plus
 * at most one `queue.getJob()` (none when the events already decide it).
 *
 * Returns `undefined` when the state cannot be determined because Redis
 * failed: callers omit the key, which clients treat as "no data" (plan R6).
 * `done`/`empty` still resolve then, as they need no Redis. The failure is
 * logged without the error message (it can carry connection details).
 */
export async function resolveOcrState(
  queue: OcrJobLookup | null | undefined,
  batchId: string,
  events: readonly OcrEventLike[] | undefined,
  logger: Pick<Logger, 'warn'>,
  now: Date = new Date(),
): Promise<CertificateOcrState | null | undefined> {
  const decided = fromEvents(events ?? []);
  if (decided !== 'job') return decided;
  let jobState: string | null = null;
  if (queue) {
    try {
      const job = await queue.getJob(certificateOcrJobId(batchId));
      jobState = job ? await job.getState() : null;
    } catch (error) {
      logger.warn(
        `certificate OCR state lookup failed (${error instanceof Error ? error.name : 'unknown'})`,
      );
      return undefined;
    }
  }
  return deriveOcrState(events ?? [], jobState, now);
}
