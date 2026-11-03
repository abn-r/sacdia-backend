import type { BatchResponse, MulticastMessage } from 'firebase-admin/messaging';
import { firebaseAdmin } from '../config/firebase-admin.module';

/**
 * FCM is moving from registration tokens to Firebase Installation IDs (FIDs).
 * Both live in `user_fcm_tokens.token`; `user_fcm_tokens.kind` says which one a
 * row holds. Every send site goes through this module so a batch is split into
 * `tokens` and `fids` in exactly one place.
 */
export const FCM_TOKEN_KINDS = ['token', 'fid'] as const;
export type FcmTokenKind = (typeof FCM_TOKEN_KINDS)[number];
export const DEFAULT_FCM_TOKEN_KIND: FcmTokenKind = 'token';

/** Max targets (tokens + fids combined) FCM accepts in one multicast. */
export const FCM_MAX_BATCH_SIZE = 500;

/**
 * FCM error codes that indicate a token/FID is permanently invalid and should
 * be deactivated. Transient errors (rate limits, server errors, etc.) are NOT
 * included — those targets should be retried, not discarded.
 */
export const PERMANENT_FCM_ERROR_CODES: ReadonlySet<string> = new Set([
  'messaging/invalid-registration-token',
  'messaging/registration-token-not-registered',
  'messaging/installation-id-not-registered',
  'messaging/invalid-argument',
]);

/**
 * A `user_fcm_tokens` row as the send path sees it. A missing `kind` (rows
 * from callers that predate the column) is a registration token.
 */
export interface FcmTargetRow {
  token: string;
  kind?: string | null;
}

export interface FcmTargets<T extends FcmTargetRow = FcmTargetRow> {
  tokens: string[];
  fids: string[];
  /**
   * The rows in the order FCM answers: every registration token first, then
   * every FID (firebase-admin builds `[...tokens, ...fids]`). `responses[i]`
   * belongs to `ordered[i]`.
   */
  ordered: T[];
}

export function isFid(row: FcmTargetRow): boolean {
  return row.kind === 'fid';
}

/**
 * Splits rows into the `tokens` and `fids` lists of a multicast message and
 * returns them in the order the responses will come back.
 */
export function buildFcmTargets<T extends FcmTargetRow>(
  rows: readonly T[],
): FcmTargets<T> {
  const tokenRows = rows.filter((row) => !isFid(row));
  const fidRows = rows.filter((row) => isFid(row));
  return {
    tokens: tokenRows.map((row) => row.token),
    fids: fidRows.map((row) => row.token),
    ordered: [...tokenRows, ...fidRows],
  };
}

/** Everything in a multicast except the targets. */
export type FcmBaseMessage = Omit<MulticastMessage, 'tokens' | 'fids'>;

/**
 * Sends one multicast (at most FCM_MAX_BATCH_SIZE rows, tokens and FIDs
 * combined) and returns the response with the rows aligned to
 * `response.responses`.
 */
export async function sendToTargets<T extends FcmTargetRow>(
  rows: readonly T[],
  base: FcmBaseMessage,
): Promise<{ response: BatchResponse; ordered: T[] }> {
  const { tokens, fids, ordered } = buildFcmTargets(rows);
  // Empty lists are left out: FCM only needs one non-empty list, and a
  // tokens-only payload stays identical to what old clients always produced.
  const response = await firebaseAdmin.getMessaging().sendEachForMulticast({
    ...(tokens.length > 0 ? { tokens } : {}),
    ...(fids.length > 0 ? { fids } : {}),
    ...base,
  } as MulticastMessage);
  return { response, ordered };
}

export interface FcmSendOutcome<T extends FcmTargetRow = FcmTargetRow> {
  /** Rows whose error is permanent: deactivate them. */
  permanentlyFailed: T[];
  /** Rows that failed with a retryable error, with its code. */
  transient: { row: T; code: string }[];
  /** Rows FCM accepted. */
  succeeded: T[];
}

/** Maps `response.responses[i]` back to `ordered[i]` and classifies it. */
export function classifySendResponse<T extends FcmTargetRow>(
  ordered: readonly T[],
  response: BatchResponse,
): FcmSendOutcome<T> {
  const outcome: FcmSendOutcome<T> = {
    permanentlyFailed: [],
    transient: [],
    succeeded: [],
  };
  (response.responses ?? []).forEach((resp, idx) => {
    const row = ordered[idx];
    if (!row) return;
    if (resp.success) {
      outcome.succeeded.push(row);
      return;
    }
    const code = resp.error?.code ?? '';
    if (PERMANENT_FCM_ERROR_CODES.has(code)) {
      outcome.permanentlyFailed.push(row);
    } else {
      outcome.transient.push({ row, code: code || 'unknown' });
    }
  });
  return outcome;
}
