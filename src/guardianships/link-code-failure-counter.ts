import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Inject, Injectable } from '@nestjs/common';
import type { Cache } from 'cache-manager';
import { LINK_CODE_FAILURE_WINDOW_MS } from './guardianships.constants';

/**
 * INCR + PEXPIRE on the first hit, in ONE server-side step. The window is
 * anchored at the FIRST failure: later failures keep counting but never extend
 * it. A counter that somehow lost its expiry is healed so it cannot lock a user
 * out forever.
 */
const INCREMENT_SCRIPT = `
local count = redis.call('INCR', KEYS[1])
if count == 1 or redis.call('PTTL', KEYS[1]) < 0 then
  redis.call('PEXPIRE', KEYS[1], ARGV[1])
end
return count
`;

interface RedisCounterClient {
  eval(
    script: string,
    options: { keys: string[]; arguments: string[] },
  ): Promise<unknown>;
  get(key: string): Promise<string | null>;
}

interface RedisBackedAdapter {
  getClient(): Promise<RedisCounterClient>;
}

interface MemoryWindow {
  count: number;
  expiresAt: number;
}

/**
 * Failed link-code redeems per user, counted ATOMICALLY.
 *
 * The previous read-modify-write over cache-manager lost updates: N parallel
 * guesses could register as one failure, so the lockout threshold could be
 * dodged. Production counts with a single Redis EVAL on the client behind the
 * cache store. Without Redis (local development, tests) the cache is a
 * per-process memory store and a synchronous Map gives the same guarantee,
 * because nothing awaits between its read and its write.
 *
 * Redis errors propagate so the caller can apply its own best-effort policy.
 */
@Injectable()
export class LinkCodeFailureCounter {
  private readonly memory = new Map<string, MemoryWindow>();

  constructor(@Inject(CACHE_MANAGER) private readonly cache: Cache) {}

  private key(userId: string): string {
    // v2: a different shape from the old JSON cache entry under `linkcode:fail:`.
    return `linkcode:failures:v2:${userId}`;
  }

  /** Failures recorded in the current window (0 when none or expired). */
  async current(userId: string): Promise<number> {
    const client = await this.redisClient();
    if (client) {
      const raw = await client.get(this.key(userId));
      const parsed = raw === null ? 0 : Number.parseInt(raw, 10);
      return Number.isFinite(parsed) ? parsed : 0;
    }
    return this.liveMemoryWindow(userId, Date.now())?.count ?? 0;
  }

  /** Records one failure and returns the count after it (atomic). */
  async increment(userId: string): Promise<number> {
    const client = await this.redisClient();
    if (client) {
      const result = await client.eval(INCREMENT_SCRIPT, {
        keys: [this.key(userId)],
        arguments: [String(LINK_CODE_FAILURE_WINDOW_MS)],
      });
      return Number(result);
    }

    const now = Date.now();
    this.sweepMemory(now);
    const live = this.liveMemoryWindow(userId, now);
    if (live) {
      live.count += 1;
      return live.count;
    }
    this.memory.set(userId, {
      count: 1,
      expiresAt: now + LINK_CODE_FAILURE_WINDOW_MS,
    });
    return 1;
  }

  /** Bounds the Map: drops expired windows once it grows. */
  private sweepMemory(now: number): void {
    if (this.memory.size < 1_000) return;
    for (const [userId, window] of this.memory) {
      if (window.expiresAt <= now) this.memory.delete(userId);
    }
  }

  private liveMemoryWindow(userId: string, now: number): MemoryWindow | null {
    const window = this.memory.get(userId);
    if (!window) return null;
    if (window.expiresAt <= now) {
      this.memory.delete(userId);
      return null;
    }
    return window;
  }

  /** The Redis client behind the cache store, or null on a memory cache. */
  private async redisClient(): Promise<RedisCounterClient | null> {
    const stores =
      (this.cache as unknown as { stores?: Array<{ store?: unknown }> })
        .stores ?? [];
    for (const keyv of stores) {
      const adapter = keyv.store as Partial<RedisBackedAdapter> | undefined;
      if (adapter && typeof adapter.getClient === 'function') {
        return adapter.getClient();
      }
    }
    return null;
  }
}
