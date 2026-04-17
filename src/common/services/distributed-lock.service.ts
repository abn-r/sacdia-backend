import { Injectable, Logger, Inject } from '@nestjs/common';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import type { Cache } from 'cache-manager';

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
 * - This is NOT a reentrant lock. Do not call tryAcquire twice for the
 *   same key without releasing in between.
 */
@Injectable()
export class DistributedLockService {
  private readonly logger = new Logger(DistributedLockService.name);

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
}
