import { Logger, OnApplicationShutdown } from '@nestjs/common';
import { createClient, type RedisClientType } from 'redis';
import {
  DedupedErrorLogger,
  redisErrorHint,
} from '../common/observability/deduped-error-logger';

type ThrottlerStorageRecord = {
  totalHits: number;
  timeToExpire: number;
  isBlocked: boolean;
  timeToBlockExpire: number;
};

const REDIS_PROTOCOL_VERSION = 2 as const;
const REDIS_KEEP_ALIVE_INITIAL_DELAY_MS = 5_000;
const DEFAULT_FAIL_OPEN_COOLDOWN_MS = 15_000;
type NoRedisExtensions = Record<never, never>;
type Redis2Client = RedisClientType<
  NoRedisExtensions,
  NoRedisExtensions,
  NoRedisExtensions,
  2
>;

export function createRedisThrottlerClient(redisUrl: string): Redis2Client {
  return createClient({
    url: redisUrl,
    // node-redis v6 defaults to RESP3. Keep RESP2 until response-shape
    // migration is reviewed independently.
    RESP: REDIS_PROTOCOL_VERSION,
    socket: {
      // Preserve the node-redis v5 default instead of v6's 30-second delay.
      keepAliveInitialDelay: REDIS_KEEP_ALIVE_INITIAL_DELAY_MS,
    },
    commandOptions: {
      // Preserve the node-redis v5 no-timeout behavior. A bounded command
      // timeout requires a separate production SLO decision.
      timeout: undefined,
    },
  });
}

type RedisThrottlerClient = ReturnType<typeof createRedisThrottlerClient>;

export interface RedisThrottlerStorageOptions {
  /**
   * When true (default) a Redis error (connection refused, timeout, command
   * quota exhausted, ...) lets the request through unthrottled instead of
   * failing it. Rate limiting is therefore OFF while Redis is unavailable.
   */
  failOpen?: boolean;
  /** After a Redis failure, skip Redis entirely for this long. */
  failOpenCooldownMs?: number;
  now?: () => number;
}

/**
 * Redis-backed storage for @nestjs/throttler v6.
 *
 * The default throttler storage is process-local memory, which is not safe for
 * horizontally scaled production APIs. This implementation keeps counters and
 * block markers in Redis so all instances share the same rate-limit state.
 *
 * Failure policy: only errors raised by the Redis client (connect / EVAL) are
 * swallowed, and only when `failOpen` is on. After one failure a short
 * cooldown short-circuits further calls so a dead Redis neither adds latency
 * to every request nor burns more of a rate-limited quota. Over-limit
 * decisions (isBlocked) are never affected.
 */
export class RedisThrottlerStorage implements OnApplicationShutdown {
  private readonly logger = new Logger(RedisThrottlerStorage.name);
  private readonly client: RedisThrottlerClient;
  private readonly failOpen: boolean;
  private readonly failOpenCooldownMs: number;
  private readonly now: () => number;
  private failOpenUntil = 0;
  private degraded = false;

  constructor(redisUrl: string, options: RedisThrottlerStorageOptions = {}) {
    this.failOpen = options.failOpen ?? true;
    this.failOpenCooldownMs =
      options.failOpenCooldownMs ?? DEFAULT_FAIL_OPEN_COOLDOWN_MS;
    this.now = options.now ?? Date.now;
    this.client = createRedisThrottlerClient(redisUrl);
    // node-redis emits 'error' on every reconnect attempt (~1-2 s apart).
    const clientErrors = new DedupedErrorLogger(this.logger);
    this.client.on('error', (error: Error) => {
      clientErrors.log('Redis throttler error', error, redisErrorHint(error));
    });
  }

  async assertReady(): Promise<void> {
    await this.ensureConnected();
    await this.client.ping();
  }

  async increment(
    key: string,
    ttl: number,
    limit: number,
    blockDuration: number,
    throttlerName: string,
  ): Promise<ThrottlerStorageRecord> {
    if (this.failOpen && this.now() < this.failOpenUntil) {
      return this.permissiveRecord(ttl);
    }

    const hitsKey = this.buildHitsKey(key, throttlerName);
    const blockKey = this.buildBlockKey(key, throttlerName);
    let result: [number, number, number, number];
    try {
      await this.ensureConnected();
      result = (await this.client.eval(INCREMENT_SCRIPT, {
        keys: [hitsKey, blockKey],
        arguments: [
          String(Math.max(ttl, 1)),
          String(limit),
          String(Math.max(blockDuration, 1)),
        ],
      })) as [number, number, number, number];
    } catch (error) {
      if (!this.failOpen) throw error;
      this.enterFailOpen(error);
      return this.permissiveRecord(ttl);
    }

    if (this.degraded) {
      this.degraded = false;
      this.logger.log(
        'Redis throttler recovered; rate limiting is active again',
      );
    }

    const [totalHits, timeToExpireMs, isBlocked, timeToBlockExpireMs] = result;

    return {
      totalHits,
      timeToExpire: this.millisecondsToSeconds(timeToExpireMs),
      isBlocked: isBlocked === 1,
      timeToBlockExpire: this.millisecondsToSeconds(timeToBlockExpireMs),
    };
  }

  async onApplicationShutdown(): Promise<void> {
    if (this.client.isOpen) {
      await this.client.quit();
    }
  }

  private enterFailOpen(error: unknown): void {
    this.failOpenUntil = this.now() + this.failOpenCooldownMs;
    this.degraded = true;
    const message = error instanceof Error ? error.message : String(error);
    // Logged once per cooldown window at most: requests during the cooldown
    // never reach Redis and never reach this method.
    this.logger.error(
      `Redis throttler unavailable (${message}); failing open - rate limiting is DISABLED until Redis recovers (retry in ${this.failOpenCooldownMs} ms)`,
    );
  }

  private permissiveRecord(ttl: number): ThrottlerStorageRecord {
    return {
      totalHits: 0,
      timeToExpire: this.millisecondsToSeconds(ttl),
      isBlocked: false,
      timeToBlockExpire: 0,
    };
  }

  private buildHitsKey(key: string, throttlerName: string): string {
    return `throttler:${throttlerName}:${key}:hits`;
  }

  private buildBlockKey(key: string, throttlerName: string): string {
    return `throttler:${throttlerName}:${key}:blocked`;
  }

  private millisecondsToSeconds(value: number): number {
    if (value <= 0) return 0;
    return Math.ceil(value / 1000);
  }

  private async ensureConnected(): Promise<void> {
    if (this.client.isOpen && this.client.isReady) {
      return;
    }

    if (this.client.isOpen) {
      await this.client.disconnect();
    }

    await this.client.connect();
  }
}

const INCREMENT_SCRIPT = `
local hits_key = KEYS[1]
local block_key = KEYS[2]
local ttl = tonumber(ARGV[1])
local limit = tonumber(ARGV[2])
local block_duration = tonumber(ARGV[3])

local block_ttl = redis.call('PTTL', block_key)
if block_ttl > 0 then
  local current_hits = tonumber(redis.call('GET', hits_key) or limit + 1)
  local hit_ttl = redis.call('PTTL', hits_key)
  if hit_ttl < 0 then
    hit_ttl = block_ttl
  end
  return { current_hits, hit_ttl, 1, block_ttl }
end

local total_hits = redis.call('INCR', hits_key)
if total_hits == 1 then
  redis.call('PEXPIRE', hits_key, ttl)
end

local hit_ttl = redis.call('PTTL', hits_key)
if hit_ttl < 0 then
  hit_ttl = ttl
  redis.call('PEXPIRE', hits_key, ttl)
end

if total_hits > limit then
  redis.call('SET', block_key, '1', 'PX', block_duration)
  redis.call('PEXPIRE', hits_key, block_duration)
  return { total_hits, block_duration, 1, block_duration }
end

return { total_hits, hit_ttl, 0, 0 }
`;
