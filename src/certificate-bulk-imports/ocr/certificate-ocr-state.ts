import type { Logger } from '@nestjs/common';
import type { Queue } from 'bullmq';
import { certificateOcrJobId } from './certificate-ocr.queue';

/**
 * Public OCR read state of a batch (plan D3, section 4.6). Derived, never
 * stored. `null` means OCR was never requested for the batch.
 */
export type CertificateOcrState =
  'pending' | 'running' | 'done' | 'empty' | 'failed';

/** Generic code: the worker failed but its code is not a known public one. */
export const OCR_GENERIC_ERROR_CODE = 'CERTIFICATE_IMPORT_OCR_FAILED';

/**
 * Failure codes the OCR module throws (provider mapping, sealed-object read,
 * `runQueuedOcr` preconditions). Only these are ever persisted or exposed:
 * the failure event stores a code and nothing else (no message, text or URL).
 * The names are the real public error codes, the same ones the 400 at enqueue
 * time uses.
 */
export const OCR_PUBLIC_ERROR_CODES: ReadonlySet<string> = new Set([
  'CERTIFICATE_IMPORT_OCR_UNAVAILABLE',
  'CERTIFICATE_IMPORT_OCR_FAILED',
  'CERTIFICATE_IMPORT_OCR_QUOTA',
  'CERTIFICATE_IMPORT_OCR_UNSUPPORTED_TYPE',
  'CERTIFICATE_IMPORT_OCR_FILE_TOO_LARGE',
  'CERTIFICATE_IMPORT_PDF_TOO_MANY_PAGES',
  'CERTIFICATE_IMPORT_PDF_INVALID',
  'CERTIFICATE_IMPORT_PDF_ENCRYPTED',
  'CERTIFICATE_IMPORT_STORAGE_UNAVAILABLE',
  'CERTIFICATE_IMPORT_FILE_NOT_CONFIRMED',
  'CERTIFICATE_IMPORT_FILE_CONTENT_MISMATCH',
  'CERTIFICATE_IMPORT_FILE_TOO_LARGE',
  'CERTIFICATE_IMPORT_FILE_URL_INVALID',
  'CERTIFICATE_IMPORT_CANNOT_PROCESS_OCR',
  'CERTIFICATE_IMPORT_BATCH_NOT_FOUND',
]);

/** Known public code as is; anything else (or non-string) becomes generic. */
export function sanitizeOcrErrorCode(code: unknown): string {
  return typeof code === 'string' && OCR_PUBLIC_ERROR_CODES.has(code)
    ? code
    : OCR_GENERIC_ERROR_CODE;
}

/** What the batch responses carry: `ocr_state` plus the failure code. */
export type CertificateOcrStatus = {
  ocr_state: CertificateOcrState | null;
  /** Only non-null when `ocr_state === 'failed'` and the worker reported why. */
  ocr_error_code: string | null;
};

export const OCR_NEVER_REQUESTED: CertificateOcrStatus = {
  ocr_state: null,
  ocr_error_code: null,
};

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

type EventDecision =
  { kind: 'final'; status: CertificateOcrStatus } | { kind: 'job' };

const final = (
  ocr_state: CertificateOcrState | null,
  ocr_error_code: string | null = null,
): EventDecision => ({ kind: 'final', status: { ocr_state, ocr_error_code } });

/**
 * Event half of the derivation: `final` when the events alone decide it, or
 * `job` when the live job must be consulted.
 */
function fromEvents(events: readonly OcrEventLike[]): EventDecision {
  const queued = latest(events, 'OCR_QUEUED');
  if (!queued) return final(null);
  const processed = latest(events, 'OCR_PROCESSED');
  if (processed && processed.at >= queued.at) {
    return final(itemCount(processed.event.payload) > 0 ? 'done' : 'empty');
  }
  // Terminal failure recorded by the worker. Only a failure at or after the
  // latest OCR_QUEUED counts, so a retry (new OCR_QUEUED) clears the code.
  const failure = latest(events, 'OCR_FAILED');
  if (failure && failure.at >= queued.at) {
    const code = (failure.event.payload as { error_code?: unknown } | null)
      ?.error_code;
    return final('failed', sanitizeOcrErrorCode(code));
  }
  return { kind: 'job' };
}

/**
 * Pure derivation. Precedence, first match wins:
 * 1. No `OCR_QUEUED` event: `null` (never requested).
 * 2. `OCR_PROCESSED` at or after the latest `OCR_QUEUED`: `done` (items > 0) or
 *    `empty`. The event is the source of truth because a successful job is
 *    deleted (`removeOnComplete`). A re-run queued after an old result does
 *    not match this rule, so the old result never masks the new read.
 * 3. `OCR_FAILED` (worker's terminal failure) at or after the latest
 *    `OCR_QUEUED`: `failed` with its `ocr_error_code`.
 * 4. Live job: `active` is `running`; `waiting`/`delayed`/... is `pending`
 *    (includes the backoff between attempts); `failed` is `failed`.
 * 5. No usable job (absent, `completed` without event, `unknown`): `failed`
 *    if the latest `OCR_QUEUED` is older than 5 minutes, else `pending`.
 *
 * `ocr_error_code` is non-null only through rule 3. A `failed` inferred from
 * the job (rule 4) or the age rule (5) has no recorded cause, so the code is
 * `null` ("unknown cause") rather than a made-up generic one; clients show
 * their default failure message. A known `failed` with an unrecognized code
 * is the generic `CERTIFICATE_IMPORT_OCR_FAILED`.
 *
 * `jobState` is the BullMQ state, or `null` when the job does not exist.
 */
export function deriveOcrStatus(
  events: readonly OcrEventLike[],
  jobState: string | null,
  now: Date = new Date(),
): CertificateOcrStatus {
  const decided = fromEvents(events);
  if (decided.kind === 'final') return decided.status;
  const inferred = (ocr_state: CertificateOcrState): CertificateOcrStatus => ({
    ocr_state,
    ocr_error_code: null,
  });
  if (jobState === 'active') return inferred('running');
  if (LIVE_WAITING_STATES.has(jobState ?? '')) return inferred('pending');
  if (jobState === 'failed') return inferred('failed');
  const queued = latest(events, 'OCR_QUEUED');
  const age = now.getTime() - (queued?.at ?? now.getTime());
  return inferred(age > OCR_ORPHAN_QUEUED_MAX_AGE_MS ? 'failed' : 'pending');
}

export function deriveOcrState(
  events: readonly OcrEventLike[],
  jobState: string | null,
  now: Date = new Date(),
): CertificateOcrState | null {
  return deriveOcrStatus(events, jobState, now).ocr_state;
}

/**
 * Resolves the OCR status from the batch events already loaded by the caller
 * plus at most one `queue.getJob()` (none when the events already decide it).
 *
 * Returns `undefined` when the state cannot be determined because Redis
 * failed: callers omit the keys, which clients treat as "no data" (plan R6).
 * Event-decided states (`done`, `empty`, failure with code) still resolve
 * then, as they need no Redis. The failure is logged without the error
 * message (it can carry connection details).
 */
export async function resolveOcrState(
  queue: OcrJobLookup | null | undefined,
  batchId: string,
  events: readonly OcrEventLike[] | undefined,
  logger: Pick<Logger, 'warn'>,
  now: Date = new Date(),
): Promise<CertificateOcrStatus | undefined> {
  const decided = fromEvents(events ?? []);
  if (decided.kind === 'final') return decided.status;
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
  return deriveOcrStatus(events ?? [], jobState, now);
}
