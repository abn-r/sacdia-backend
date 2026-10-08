import { randomUUID } from 'node:crypto';

export type DispatchStatus =
  'pending' | 'sending' | 'queued' | 'sent' | 'failed' | 'skipped';

export type DispatchKey = {
  kind: string;
  executionKey: string;
  recipientUserId: string;
  role: string;
  scopeKey: string;
};

export type DispatchRow = DispatchKey & {
  dispatchId: string;
  status: DispatchStatus;
  attempts: number;
  payload: unknown;
  leaseUntil?: Date | null;
  claimToken?: string | null;
};

export type DispatchPatch = {
  status?: DispatchStatus;
  attempts?: number;
  payload?: unknown;
  lastError?: string | null;
  sentAt?: Date | null;
  leaseUntil?: Date | null;
  claimToken?: string | null;
};

export type DispatchGuard = {
  claimToken?: string;
  expiredBefore?: Date;
};

export interface DispatchStore {
  find(key: DispatchKey): Promise<DispatchRow | null>;
  create(row: DispatchRow): Promise<void>;
  updateWhere(
    key: DispatchKey,
    statuses: DispatchStatus[],
    patch: DispatchPatch,
    guard?: DispatchGuard,
  ): Promise<number>;
}

export type DeliverResult =
  'sent' | 'queued' | 'duplicate' | 'failed' | 'skipped';

export class DispatchSkipped extends Error {}

const LEASE_MS = 60_000;

export function isUniqueConflict(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: string }).code === 'P2002'
  );
}

export function leaseOpen(row: DispatchRow, now = new Date()): boolean {
  return (
    row.status === 'sending' &&
    row.leaseUntil != null &&
    row.leaseUntil.getTime() > now.getTime()
  );
}

export async function deliverOnce(
  store: DispatchStore,
  row: Omit<DispatchRow, 'dispatchId' | 'status' | 'attempts'>,
  dispatchId: string,
  send: (dispatchId: string) => Promise<'queued' | 'sent' | void>,
): Promise<DeliverResult> {
  const key = dispatchKey(row);
  const existing = await store.find(key);
  if (!existing) {
    try {
      await store.create({
        ...row,
        dispatchId,
        status: 'pending',
        attempts: 0,
        leaseUntil: null,
        claimToken: null,
      });
    } catch (error) {
      if (!isUniqueConflict(error)) {
        throw error;
      }
    }
  }
  const current = await store.find(key);
  if (
    !current ||
    current.status === 'sent' ||
    current.status === 'skipped' ||
    current.status === 'queued'
  ) {
    return 'duplicate';
  }
  if (leaseOpen(current)) {
    return 'duplicate';
  }
  const token = randomUUID();
  const reclaim = current.status === 'sending';
  const claimed = await store.updateWhere(
    key,
    reclaim ? ['sending'] : ['pending', 'failed'],
    {
      status: 'sending',
      attempts: current.attempts + 1,
      claimToken: token,
      leaseUntil: new Date(Date.now() + LEASE_MS),
    },
    reclaim ? { expiredBefore: new Date() } : undefined,
  );
  if (claimed !== 1) {
    return 'duplicate';
  }
  const owned = current.dispatchId || dispatchId;
  try {
    const handed = await send(owned);
    const status = handed === 'queued' ? 'queued' : 'sent';
    const acked = await store.updateWhere(
      key,
      ['sending'],
      {
        status,
        sentAt: status === 'sent' ? new Date() : null,
        lastError: null,
        leaseUntil: null,
        claimToken: token,
      },
      { claimToken: token },
    );
    if (acked !== 1) {
      const after = await store.find(key);
      if (after?.status === 'sent' || after?.status === 'queued') {
        return after.status;
      }
      return 'failed';
    }
    return status;
  } catch (error) {
    if (error instanceof DispatchSkipped) {
      await store.updateWhere(
        key,
        ['sending'],
        { status: 'skipped', leaseUntil: null, lastError: null },
        { claimToken: token },
      );
      return 'skipped';
    }
    const message = error instanceof Error ? error.message : String(error);
    await store.updateWhere(
      key,
      ['sending'],
      {
        status: 'failed',
        lastError: message.slice(0, 500),
        leaseUntil: null,
      },
      { claimToken: token },
    );
    return 'failed';
  }
}

export async function skipDispatch(
  store: DispatchStore,
  key: DispatchKey,
  lastError: string | null = null,
): Promise<void> {
  await store.updateWhere(key, ['pending', 'failed', 'queued', 'sending'], {
    status: 'skipped',
    leaseUntil: null,
    lastError,
  });
}

function dispatchKey(row: DispatchKey): DispatchKey {
  return {
    kind: row.kind,
    executionKey: row.executionKey,
    recipientUserId: row.recipientUserId,
    role: row.role,
    scopeKey: row.scopeKey,
  };
}
