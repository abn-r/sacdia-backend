import { randomUUID } from 'node:crypto';
import { Injectable, Logger, Inject } from '@nestjs/common';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import type { Cache } from 'cache-manager';

/**
 * Handle of a lock taken with {@link DistributedLockService.tryAcquireOwned}.
 * Only the holder of the handle can release it.
 */
export interface OwnedLock {
  key: string;
  /** Random value written in the lock; release only deletes a matching one. */
  token: string;
  /**
   * Where the lock lives: the shared Redis, this process's memory (no Redis),
   * or nowhere (Redis errored and the acquire failed open).
   */
  backend: 'redis' | 'memory' | 'none';
}

/** The slice of the node-redis client the owned lock needs. */
interface LockRedisClient {
  set(
    key: string,
    value: string,
    options: { NX: true; PX: number },
  ): Promise<string | null>;
  eval(
    script: string,
    options: { keys: string[]; arguments: string[] },
  ): Promise<unknown>;
}

/** Compare-and-delete: only the owner (same token) may delete the lock. */
const RELEASE_IF_OWNER_SCRIPT = `if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end`;

/**
 * DistributedLockService
 *
 * Provides a simple SET-NX style distributed lock backed by the shared
 * CacheManager (Redis in production, in-memory fallback in development).
 *
 * Design notes:
 * - Uses the same CACHE_MANAGER injection token and TTL convention (milliseconds)
 *   as the rest of the codebase (see catalog-cache.service.ts).
 * - If Redis is unavailable the lock always returns `true` so cron jobs
 *   continue to run — this matches the graceful-fallback pattern used
 *   throughout the project (no silent failures, always log the degradation).
 * - `tryAcquire`/`release` are the lightweight lock of the scheduled crons:
 *   get-then-set (not atomic) and release without an owner check. Good enough
 *   to dedupe a cron across instances, not to guard a run that can outlive the
 *   TTL. `tryAcquireOwned`/`releaseOwned` are the strict variant (atomic
 *   SET NX PX + compare-and-delete), used by the manual cron run.
 * - This is NOT a reentrant lock. Do not call tryAcquire twice for the
 *   same key without releasing in between.
 */
@Injectable()
export class DistributedLockService {
  private readonly logger = new Logger(DistributedLockService.name);
  private readonly memoryLocks = new Map<
    string,
    { token: string; expiresAt: number }
  >();

  constructor(@Inject(CACHE_MANAGER) private readonly cache: Cache) {}

  /**
   * Try to acquire a distributed lock.
   *
   * @param key   - Logical lock name (e.g. 'cron:activities-reminder')
   * @param ttlMs - How long (ms) to hold the lock before it auto-expires
   * @returns     - true if the lock was acquired, false if already held
   */
  async tryAcquire(key: string, ttlMs: number): Promise<boolean> {
    const lockKey = `lock:${key}`;
    try {
      const existing = await this.cache.get(lockKey);
      if (existing !== null && existing !== undefined) {
        return false;
      }
      await this.cache.set(lockKey, Date.now().toString(), ttlMs);
      return true;
    } catch (error) {
      // If Redis is down, allow execution — same graceful fallback pattern
      // used by CatalogCacheService and TokenBlacklistService.
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(
        `Could not acquire lock "${lockKey}": ${message}. Proceeding without lock.`,
      );
      return true;
    }
  }

  /**
   * Release a distributed lock explicitly.
   * Should be called in a finally block after the protected work completes.
   *
   * @param key - Logical lock name (same value passed to tryAcquire)
   */
  async release(key: string): Promise<void> {
    const lockKey = `lock:${key}`;
    try {
      await this.cache.del(lockKey);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`Could not release lock "${lockKey}": ${message}`);
    }
  }

  /**
   * Atomically take a lock and get an ownership handle.
   *
   * - Redis: `SET lock:<key> <token> NX PX <ttl>`, one atomic command, so two
   *   concurrent callers (any instance) can never both win.
   * - No Redis (local dev, in-memory cache): a process-local map. Atomic inside
   *   one process only, which is all a single-instance dev server needs.
   *   NOT safe across several instances without Redis.
   * - Redis erroring at runtime: fails open (same degradation policy as
   *   `tryAcquire`) with a `none` handle, logged.
   *
   * @returns the handle, or null when the lock is already held
   */
  async tryAcquireOwned(key: string, ttlMs: number): Promise<OwnedLock | null> {
    const lockKey = `lock:${key}`;
    const token = randomUUID();
    try {
      const client = await this.getRedisClient();
      if (!client) {
        return this.acquireInMemory(lockKey, token, ttlMs)
          ? { key, token, backend: 'memory' }
          : null;
      }
      const reply = await client.set(lockKey, token, { NX: true, PX: ttlMs });
      return reply === 'OK' ? { key, token, backend: 'redis' } : null;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(
        `Could not acquire lock "${lockKey}": ${message}. Proceeding without lock.`,
      );
      return { key, token, backend: 'none' };
    }
  }

  /**
   * Release a lock taken with `tryAcquireOwned`. It deletes the lock only if it
   * still holds our token: when the TTL expired mid-run and another holder took
   * over, this is a no-op instead of freeing THEIR lock.
   */
  async releaseOwned(lock: OwnedLock): Promise<void> {
    const lockKey = `lock:${lock.key}`;
    try {
      if (lock.backend === 'memory') {
        if (this.memoryLocks.get(lockKey)?.token === lock.token) {
          this.memoryLocks.delete(lockKey);
        }
        return;
      }
      if (lock.backend === 'none') {
        return;
      }
      const client = await this.getRedisClient();
      await client?.eval(RELEASE_IF_OWNER_SCRIPT, {
        keys: [lockKey],
        arguments: [lock.token],
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`Could not release lock "${lockKey}": ${message}`);
    }
  }

  private acquireInMemory(
    lockKey: string,
    token: string,
    ttlMs: number,
  ): boolean {
    const now = Date.now();
    const current = this.memoryLocks.get(lockKey);
    if (current && current.expiresAt > now) {
      return false;
    }
    this.memoryLocks.set(lockKey, { token, expiresAt: now + ttlMs });
    return true;
  }

  /**
   * The Redis client behind the shared cache (the Keyv Redis adapter owns the
   * connection), or null when the cache is not Redis-backed.
   */
  private async getRedisClient(): Promise<LockRedisClient | null> {
    for (const keyv of this.cache.stores ?? []) {
      const adapter = (keyv as unknown as { store?: unknown }).store as
        { getClient?: () => Promise<unknown> } | undefined;
      if (typeof adapter?.getClient === 'function') {
        return (await adapter.getClient()) as LockRedisClient;
      }
    }
    return null;
  }
}
