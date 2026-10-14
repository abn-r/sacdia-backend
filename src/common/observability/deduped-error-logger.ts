import type { Logger } from '@nestjs/common';

export interface DedupedErrorLoggerOptions {
  /** Silence window after the first occurrence of an error signature. */
  initialWindowMs?: number;
  /** Upper bound of the exponentially growing silence window. */
  maxWindowMs?: number;
  /** Max distinct signatures tracked at once (oldest evicted first). */
  maxSignatures?: number;
  now?: () => number;
}

interface SignatureState {
  window: number;
  nextLogAt: number;
  lastSeenAt: number;
  suppressed: number;
}

const DEFAULT_INITIAL_WINDOW_MS = 30_000;
const DEFAULT_MAX_WINDOW_MS = 10 * 60_000;
const DEFAULT_MAX_SIGNATURES = 50;

/**
 * Collapses a flood of identical errors into a few log lines.
 *
 * BullMQ workers and the node-redis client re-emit the same `error` every
 * ~100 ms - 2 s while Redis is unreachable or the Upstash quota is exhausted,
 * which buries every other log line. This logs the first occurrence of an
 * error signature immediately, then at most once per (exponentially growing)
 * window, reporting how many repeats were swallowed in between.
 *
 * One instance per emitter (per worker / per client), so each worker keeps
 * its own backoff state.
 */
export class DedupedErrorLogger {
  private readonly states = new Map<string, SignatureState>();
  private readonly initialWindowMs: number;
  private readonly maxWindowMs: number;
  private readonly maxSignatures: number;
  private readonly now: () => number;

  constructor(
    private readonly logger: Pick<Logger, 'error'>,
    options: DedupedErrorLoggerOptions = {},
  ) {
    this.initialWindowMs = options.initialWindowMs ?? DEFAULT_INITIAL_WINDOW_MS;
    this.maxWindowMs = options.maxWindowMs ?? DEFAULT_MAX_WINDOW_MS;
    this.maxSignatures = options.maxSignatures ?? DEFAULT_MAX_SIGNATURES;
    this.now = options.now ?? Date.now;
  }

  /**
   * @returns true when a log line was emitted, false when it was suppressed.
   */
  log(context: string, error: unknown, hint?: string): boolean {
    const message = error instanceof Error ? error.message : String(error);
    const signature = `${context}|${message.replace(/\d+/g, '#')}`;
    const now = this.now();
    const state = this.states.get(signature);

    if (!state || now - state.lastSeenAt > state.window * 2) {
      this.remember(signature, {
        window: this.initialWindowMs,
        nextLogAt: now + this.initialWindowMs,
        lastSeenAt: now,
        suppressed: 0,
      });
      this.logger.error(
        this.format(context, message, hint),
        error instanceof Error ? error.stack : undefined,
      );
      return true;
    }

    state.lastSeenAt = now;

    if (now < state.nextLogAt) {
      state.suppressed += 1;
      return false;
    }

    const suppressed = state.suppressed;
    state.suppressed = 0;
    state.window = Math.min(state.window * 2, this.maxWindowMs);
    state.nextLogAt = now + state.window;
    this.logger.error(this.format(context, message, hint, suppressed));
    return true;
  }

  private format(
    context: string,
    message: string,
    hint?: string,
    suppressed = 0,
  ): string {
    const repeats =
      suppressed > 0 ? ` (${suppressed} identical errors suppressed)` : '';
    const suffix = hint ? ` - ${hint}` : '';
    return `${context}: ${message}${repeats}${suffix}`;
  }

  private remember(signature: string, state: SignatureState): void {
    this.states.delete(signature);
    this.states.set(signature, state);
    if (this.states.size > this.maxSignatures) {
      const oldest = this.states.keys().next().value;
      if (oldest !== undefined) this.states.delete(oldest);
    }
  }
}

const QUOTA_ERROR_PATTERN = /max requests limit exceeded/i;

/** Actionable hint for the Upstash free-tier quota error, if it applies. */
export function redisErrorHint(error: unknown): string | undefined {
  const message = error instanceof Error ? error.message : String(error);
  return QUOTA_ERROR_PATTERN.test(message)
    ? 'Redis command quota exhausted; raise BULLMQ_WORKER_DRAIN_DELAY_SECONDS, disable idle workers (BULLMQ_DISABLED_QUEUES) or upgrade the Redis plan'
    : undefined;
}
