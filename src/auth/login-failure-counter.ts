import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import type { Cache } from 'cache-manager';
import { createHash } from 'node:crypto';
import {
  NOOP_SUPERVISED_LOGIN_EVENTS,
  SUPERVISED_LOGIN_EVENTS,
  type SupervisedLoginEvents,
} from './supervised/supervised-login-events.port';

/** 5 failures per identifier in 15 min lock it for 15 min; repeats double up to 24 h. */
export const LOGIN_ID_MAX_FAILURES = 5;
export const LOGIN_FAILURE_WINDOW_MS = 15 * 60 * 1000;
export const LOGIN_LOCK_BASE_MS = 15 * 60 * 1000;
export const LOGIN_LOCK_MAX_MS = 24 * 60 * 60 * 1000;
/** 30 failures per client IP in 15 min lock the IP for 15 min. */
export const LOGIN_IP_MAX_FAILURES = 30;
/**
 * Without Redis the limits are per process, so they are tightened (the IP one
 * halved) to keep the total across a few instances close to the intended one.
 */
export const LOGIN_FALLBACK_IP_MAX_FAILURES = 15;

export type LoginLockState =
  { locked: false } | { locked: true; retryAfterSeconds: number };

export interface LoginFailureOutcome {
  /** This failure started a lock episode (identifier or IP). */
  lockStarted: boolean;
  retryAfterSeconds: number;
}

/**
 * KEYS: 1 failures, 2 lock, 3 episodes.
 * ARGV: 1 window ms, 2 max failures, 3 lock base ms, 4 lock max ms, 5 calm period ms
 * (the episode history is kept for the lock itself PLUS this calm period).
 * Atomic: counts the failure, and on the threshold sets the lock (duration
 * doubles with every episode inside the episode TTL) and resets the counter.
 * Returns {count, lockMs, episode}.
 */
export const RECORD_FAILURE_SCRIPT = `
local count = redis.call('INCR', KEYS[1])
if count == 1 or redis.call('PTTL', KEYS[1]) < 0 then
  redis.call('PEXPIRE', KEYS[1], ARGV[1])
end
if count >= tonumber(ARGV[2]) then
  local episode = redis.call('INCR', KEYS[3])
  local lockMs = tonumber(ARGV[3]) * (2 ^ (episode - 1))
  if lockMs > tonumber(ARGV[4]) then lockMs = tonumber(ARGV[4]) end
  redis.call('PEXPIRE', KEYS[3], math.floor(lockMs) + tonumber(ARGV[5]))
  redis.call('SET', KEYS[2], '1', 'PX', math.floor(lockMs))
  redis.call('DEL', KEYS[1])
  return {count, math.floor(lockMs), episode}
end
return {count, 0, 0}
`;

/** Largest remaining lock TTL (ms) among the given lock keys, 0 when none. */
export const LOCK_TTL_SCRIPT = `
local ttl = 0
for i = 1, #KEYS do
  local t = redis.call('PTTL', KEYS[i])
  if t > ttl then ttl = t end
end
return ttl
`;

export const CLEAR_SCRIPT = `redis.call('DEL', KEYS[1], KEYS[2], KEYS[3]) return 1`;

interface RedisCounterClient {
  eval(
    script: string,
    options: { keys: string[]; arguments: string[] },
  ): Promise<unknown>;
}

interface RedisBackedAdapter {
  getClient(): Promise<RedisCounterClient>;
}

interface MemoryEntry {
  failures: number;
  failuresExpireAt: number;
  lockedUntil: number;
  episodes: number;
  episodesExpireAt: number;
}

type Scope = 'id' | 'ip';

/**
 * Progressive login lockout, keyed on the (case-folded) identifier and on the
 * client IP, regardless of whether the identifier exists: a lock for an unknown
 * identifier is indistinguishable from a real one.
 *
 *  - while locked, even the CORRECT password is refused and nothing resets;
 *  - the first lock lasts 15 min and doubles on each repeat up to 24 h (the
 *    episode memory resets after 24 h without a new lock, or on a success);
 *  - Redis is the source of truth (atomic Lua, shared by instances). If Redis
 *    is unreachable the counter falls back to an in-process limit and logs a
 *    warning: it NEVER fails open to unlimited tries.
 *
 * Modeled on LinkCodeFailureCounter (atomic INCR + PEXPIRE anchored at the
 * first failure). Identifiers are only ever hashed into keys; they never appear
 * in logs.
 */
@Injectable()
export class LoginFailureCounter {
  private readonly logger = new Logger(LoginFailureCounter.name);
  private readonly memory = new Map<string, MemoryEntry>();
  private lastFallbackWarnAt = 0;
  private readonly events: SupervisedLoginEvents;

  constructor(
    @Inject(CACHE_MANAGER) private readonly cache: Cache,
    @Optional()
    @Inject(SUPERVISED_LOGIN_EVENTS)
    events?: SupervisedLoginEvents,
  ) {
    this.events = events ?? NOOP_SUPERVISED_LOGIN_EVENTS;
  }

  // -- keys -----------------------------------------------------------------

  /** Case-folded, trimmed: `Ana-X` and `ana-x` share one counter. */
  normalize(identifier: string): string {
    return identifier.trim().toLowerCase();
  }

  private idHash(identifier: string): string {
    return createHash('sha256')
      .update(this.normalize(identifier))
      .digest('hex');
  }

  private keys(scope: Scope, subject: string) {
    const base = `login:%s:${scope}:${subject}`;
    return {
      failures: base.replace('%s', 'fail'),
      lock: base.replace('%s', 'lock'),
      episodes: base.replace('%s', 'lockn'),
    };
  }

  private subjectOf(scope: Scope, identifier: string, ip: string): string {
    return scope === 'id' ? this.idHash(identifier) : ip;
  }

  // -- public API ------------------------------------------------------------

  /**
   * Is this identifier or this IP locked right now? Run it BEFORE touching the
   * credentials. A correct password does not get past a lock.
   */
  async check(identifier: string, ip?: string): Promise<LoginLockState> {
    const lockKeys = [this.keys('id', this.idHash(identifier)).lock];
    // An unresolvable client IP has no bucket: sharing one would let a single
    // client lock out everybody whose IP is unknown.
    if (ip) lockKeys.push(this.keys('ip', ip).lock);
    const client = await this.redisClientSafely();
    if (client) {
      try {
        const ttl = Number(
          await client.eval(LOCK_TTL_SCRIPT, {
            keys: lockKeys,
            arguments: [],
          }),
        );
        return ttl > 0
          ? { locked: true, retryAfterSeconds: Math.ceil(ttl / 1000) }
          : { locked: false };
      } catch (error) {
        this.warnFallback(error);
      }
    }
    return this.checkMemory(identifier, ip, Date.now());
  }

  /**
   * One wrong password. Counts against the identifier AND the IP; returns
   * whether this failure started a lock episode (the guardians are told once
   * per episode, through the SupervisedLoginEvents port).
   */
  async recordFailure(
    identifier: string,
    ip?: string,
  ): Promise<LoginFailureOutcome> {
    const idOutcome = await this.recordOne('id', identifier, ip ?? '');
    const ipOutcome: LoginFailureOutcome = ip
      ? await this.recordOne('ip', identifier, ip)
      : { lockStarted: false, retryAfterSeconds: 0 };
    const lockStarted = idOutcome.lockStarted || ipOutcome.lockStarted;
    const retryAfterSeconds = Math.max(
      idOutcome.retryAfterSeconds,
      ipOutcome.retryAfterSeconds,
    );

    if (idOutcome.lockStarted) {
      // Fire and forget: a notification problem never reaches the login.
      void Promise.resolve()
        .then(() =>
          this.events.onLoginLocked({
            identifier: this.normalize(identifier),
            retryAfterSeconds: idOutcome.retryAfterSeconds,
          }),
        )
        .catch((error: unknown) => {
          this.logger.warn(
            `login lock event failed: ${error instanceof Error ? error.message : String(error)}`,
          );
        });
    }
    return { lockStarted, retryAfterSeconds };
  }

  /**
   * A successful login clears the identifier's counter and its lock history.
   * The IP counter is deliberately left alone: one good account does not erase
   * an IP's earlier guessing.
   */
  async recordSuccess(identifier: string): Promise<void> {
    const keys = this.keys('id', this.idHash(identifier));
    const client = await this.redisClientSafely();
    if (client) {
      try {
        await client.eval(CLEAR_SCRIPT, {
          keys: [keys.failures, keys.lock, keys.episodes],
          arguments: [],
        });
        return;
      } catch (error) {
        this.warnFallback(error);
      }
    }
    this.memory.delete(keys.failures);
  }

  // -- Redis path ------------------------------------------------------------

  private async recordOne(
    scope: Scope,
    identifier: string,
    ip: string,
  ): Promise<LoginFailureOutcome> {
    const keys = this.keys(scope, this.subjectOf(scope, identifier, ip));
    const max = scope === 'id' ? LOGIN_ID_MAX_FAILURES : LOGIN_IP_MAX_FAILURES;
    // The IP lock does not double: it is a flat 15 minutes.
    const lockMax = scope === 'id' ? LOGIN_LOCK_MAX_MS : LOGIN_LOCK_BASE_MS;

    const client = await this.redisClientSafely();
    if (client) {
      try {
        const [, lockMs] = (await client.eval(RECORD_FAILURE_SCRIPT, {
          keys: [keys.failures, keys.lock, keys.episodes],
          arguments: [
            String(LOGIN_FAILURE_WINDOW_MS),
            String(max),
            String(LOGIN_LOCK_BASE_MS),
            String(lockMax),
            String(LOGIN_LOCK_MAX_MS),
          ],
        })) as [number, number, number];
        return {
          lockStarted: Number(lockMs) > 0,
          retryAfterSeconds: Math.ceil(Number(lockMs) / 1000),
        };
      } catch (error) {
        this.warnFallback(error);
      }
    }
    return this.recordMemory(scope, keys, Date.now());
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

  private async redisClientSafely(): Promise<RedisCounterClient | null> {
    try {
      return await this.redisClient();
    } catch (error) {
      this.warnFallback(error);
      return null;
    }
  }

  // -- in-process path (no Redis, or Redis unreachable) ------------------------

  private entry(key: string, now: number): MemoryEntry {
    const existing = this.memory.get(key);
    const entry: MemoryEntry = existing ?? {
      failures: 0,
      failuresExpireAt: 0,
      lockedUntil: 0,
      episodes: 0,
      episodesExpireAt: 0,
    };
    if (entry.failuresExpireAt <= now) entry.failures = 0;
    if (entry.episodesExpireAt <= now) entry.episodes = 0;
    return entry;
  }

  private sweepMemory(now: number): void {
    if (this.memory.size < 5_000) return;
    for (const [key, entry] of this.memory) {
      if (
        entry.lockedUntil <= now &&
        entry.failuresExpireAt <= now &&
        entry.episodesExpireAt <= now
      ) {
        this.memory.delete(key);
      }
    }
  }

  private checkMemory(
    identifier: string,
    ip: string | undefined,
    now: number,
  ): LoginLockState {
    let until = 0;
    const subjects: Array<readonly [Scope, string]> = [
      ['id', this.idHash(identifier)],
    ];
    if (ip) subjects.push(['ip', ip]);
    for (const [scope, subject] of subjects) {
      const entry = this.memory.get(this.keys(scope, subject).failures);
      if (entry && entry.lockedUntil > until) until = entry.lockedUntil;
    }
    return until > now
      ? { locked: true, retryAfterSeconds: Math.ceil((until - now) / 1000) }
      : { locked: false };
  }

  private recordMemory(
    scope: Scope,
    keys: { failures: string },
    now: number,
  ): LoginFailureOutcome {
    this.sweepMemory(now);
    const entry = this.entry(keys.failures, now);
    if (entry.failures === 0)
      entry.failuresExpireAt = now + LOGIN_FAILURE_WINDOW_MS;
    entry.failures += 1;

    const max =
      scope === 'id' ? LOGIN_ID_MAX_FAILURES : LOGIN_FALLBACK_IP_MAX_FAILURES;
    let lockMs = 0;
    if (entry.failures >= max) {
      entry.episodes += 1;
      const cap = scope === 'id' ? LOGIN_LOCK_MAX_MS : LOGIN_LOCK_BASE_MS;
      lockMs = Math.min(LOGIN_LOCK_BASE_MS * 2 ** (entry.episodes - 1), cap);
      entry.episodesExpireAt = now + lockMs + LOGIN_LOCK_MAX_MS;
      entry.lockedUntil = now + lockMs;
      entry.failures = 0;
      entry.failuresExpireAt = 0;
    }
    this.memory.set(keys.failures, entry);
    return {
      lockStarted: lockMs > 0,
      retryAfterSeconds: Math.ceil(lockMs / 1000),
    };
  }

  private warnFallback(error: unknown): void {
    const now = Date.now();
    if (now - this.lastFallbackWarnAt < 30_000) return;
    this.lastFallbackWarnAt = now;
    this.logger.warn(
      JSON.stringify({
        event: 'login_lockout_redis_unavailable',
        note: 'using the in-process limit; never failing open',
        reason: error instanceof Error ? error.message : String(error),
      }),
    );
  }
}
