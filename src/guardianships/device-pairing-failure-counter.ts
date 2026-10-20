import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Inject, Injectable } from '@nestjs/common';
import type { Cache } from 'cache-manager';

/** Failed pairing attempts per client IP: 30 in a day lock the IP out (FP3-42). */
export const DEVICE_PAIRING_MAX_FAILURES = 30;
export const DEVICE_PAIRING_FAILURE_WINDOW_MS = 24 * 60 * 60 * 1000;

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
 * Failed device-pairing redeems per client IP, counted ATOMICALLY (same
 * mechanism as the link-code counter: one Redis EVAL, or a synchronous Map on a
 * memory cache). The window opens at the FIRST failure and later failures never
 * extend it. Redis errors propagate so the caller can apply its own policy
 * (the pairing service stays conservative: the route is also throttled).
 */
@Injectable()
export class DevicePairingFailureCounter {
  private readonly memory = new Map<string, MemoryWindow>();

  constructor(@Inject(CACHE_MANAGER) private readonly cache: Cache) {}

  private key(ip: string): string {
    return `device-pairing:failures:v1:${ip}`;
  }

  /** Failures recorded in the current window (0 when none or expired). */
  async current(ip: string): Promise<number> {
    const client = await this.redisClient();
    if (client) {
      const raw = await client.get(this.key(ip));
      const parsed = raw === null ? 0 : Number.parseInt(raw, 10);
      return Number.isFinite(parsed) ? parsed : 0;
    }
    return this.liveMemoryWindow(ip, Date.now())?.count ?? 0;
  }

  /** Records one failure and returns the count after it (atomic). */
  async increment(ip: string): Promise<number> {
    const client = await this.redisClient();
    if (client) {
      const result = await client.eval(INCREMENT_SCRIPT, {
        keys: [this.key(ip)],
        arguments: [String(DEVICE_PAIRING_FAILURE_WINDOW_MS)],
      });
      return Number(result);
    }

    const now = Date.now();
    this.sweepMemory(now);
    const live = this.liveMemoryWindow(ip, now);
    if (live) {
      live.count += 1;
      return live.count;
    }
    this.memory.set(ip, {
      count: 1,
      expiresAt: now + DEVICE_PAIRING_FAILURE_WINDOW_MS,
    });
    return 1;
  }

  /** Bounds the Map: drops expired windows once it grows. */
  private sweepMemory(now: number): void {
    if (this.memory.size < 1_000) return;
    for (const [ip, window] of this.memory) {
      if (window.expiresAt <= now) this.memory.delete(ip);
    }
  }

  private liveMemoryWindow(ip: string, now: number): MemoryWindow | null {
    const window = this.memory.get(ip);
    if (!window) return null;
    if (window.expiresAt <= now) {
      this.memory.delete(ip);
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
