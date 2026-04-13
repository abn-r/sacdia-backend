import { Injectable, Logger, Inject } from '@nestjs/common';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import type { Cache } from 'cache-manager';

/**
 * Cache keys for all catalog entities.
 *
 * Convention: `cache:catalogs:{entity}[:{qualifier}]`
 *   - Static catalogs (no filter):  `cache:catalogs:club_types`
 *   - Filtered catalogs:            `cache:catalogs:unions:country:42`
 */
export const CATALOG_CACHE_KEYS = {
  CLUB_TYPES: 'cache:catalogs:club_types',
  ACTIVITY_TYPES: 'cache:catalogs:activity_types',
  RELATIONSHIP_TYPES: 'cache:catalogs:relationship_types',
  COUNTRIES: 'cache:catalogs:countries',
  UNIONS: (countryId?: number) =>
    countryId
      ? `cache:catalogs:unions:country:${countryId}`
      : 'cache:catalogs:unions:all',
  LOCAL_FIELDS: (unionId?: number) =>
    unionId
      ? `cache:catalogs:local_fields:union:${unionId}`
      : 'cache:catalogs:local_fields:all',
  DISTRICTS: (localFieldId?: number) =>
    localFieldId
      ? `cache:catalogs:districts:lf:${localFieldId}`
      : 'cache:catalogs:districts:all',
  CHURCHES: (districtId?: number) =>
    districtId
      ? `cache:catalogs:churches:district:${districtId}`
      : 'cache:catalogs:churches:all',
  ROLES: (category?: string) =>
    category
      ? `cache:catalogs:roles:${category.toLowerCase()}`
      : 'cache:catalogs:roles:all',
  // v2: shape changed in commit 9c7b28f (year_id → ecclesiastical_year_id).
  // Bumping the suffix orphans stale v1 payloads instead of crashing readers.
  ECCLESIASTICAL_YEARS: 'cache:catalogs:ecclesiastical_years:v2',
  ECCLESIASTICAL_YEARS_CURRENT: 'cache:catalogs:ecclesiastical_years:v2:current',
  CLUB_IDEALS: (clubTypeId?: number) =>
    clubTypeId
      ? `cache:catalogs:club_ideals:type:${clubTypeId}`
      : 'cache:catalogs:club_ideals:all',
  ALLERGIES: 'cache:catalogs:allergies',
  DISEASES: 'cache:catalogs:diseases',
  MEDICINES: 'cache:catalogs:medicines',
} as const;

/**
 * Prefix used to identify all catalog cache entries.
 * Used for pattern-based bulk invalidation.
 */
const CATALOG_PREFIX = 'cache:catalogs:';

/**
 * Default TTL for catalog data — 1 hour in milliseconds.
 * Catalogs rarely change, so a long TTL is appropriate.
 */
const DEFAULT_CATALOG_TTL_MS = 3_600_000; // 1 hour

/**
 * CatalogCacheService
 *
 * Wraps the NestJS CacheManager to provide catalog-specific caching
 * with the cache-aside pattern:
 *   1. Check cache first
 *   2. On miss: query DB, populate cache, return result
 *   3. On write (admin mutation): invalidate the relevant key(s)
 *
 * Redis failures are caught and logged — the caller always receives
 * a valid result (falls back to the DB value supplied).
 */
@Injectable()
export class CatalogCacheService {
  private readonly logger = new Logger(CatalogCacheService.name);

  constructor(@Inject(CACHE_MANAGER) private readonly cacheManager: Cache) {}

  /**
   * Execute the cache-aside pattern for a catalog query.
   *
   * @param key    - Cache key (use CATALOG_CACHE_KEYS constants)
   * @param loader - Async function that queries the database on cache miss
   * @param ttlMs  - TTL in milliseconds (defaults to 1 hour)
   */
  async getOrSet<T>(
    key: string,
    loader: () => Promise<T>,
    ttlMs = DEFAULT_CATALOG_TTL_MS,
  ): Promise<T> {
    try {
      const cached = await this.cacheManager.get<T>(key);
      if (cached !== null && cached !== undefined) {
        this.logger.debug(`Cache HIT  — ${key}`);
        return cached;
      }
    } catch (err) {
      // Redis down or serialization error — degrade gracefully
      this.logger.warn(
        `Cache GET fallido para "${key}": ${this.extractMessage(err)}`,
      );
    }

    this.logger.debug(`Cache MISS — ${key}`);
    const data = await loader();

    try {
      await this.cacheManager.set(key, data, ttlMs);
      this.logger.debug(`Cache SET  — ${key} (TTL ${ttlMs}ms)`);
    } catch (err) {
      this.logger.warn(
        `Cache SET fallido para "${key}": ${this.extractMessage(err)}`,
      );
    }

    return data;
  }

  /**
   * Invalidate a single catalog cache key.
   *
   * @param key - The exact cache key to remove
   */
  async invalidate(key: string): Promise<void> {
    try {
      await this.cacheManager.del(key);
      this.logger.log(`Cache INVALIDATED — ${key}`);
    } catch (err) {
      this.logger.warn(
        `Cache DEL fallido para "${key}": ${this.extractMessage(err)}`,
      );
    }
  }

  /**
   * Invalidate multiple catalog cache keys at once.
   * Useful when a mutation can affect several variants of the same entity
   * (e.g., unions:all and unions:country:{id}).
   *
   * @param keys - Array of cache keys to remove
   */
  async invalidateMany(keys: string[]): Promise<void> {
    await Promise.allSettled(keys.map((k) => this.invalidate(k)));
  }

  /**
   * Invalidate ALL catalog cache entries.
   *
   * Strategy: attempt pattern-based deletion via the underlying Redis client
   * (available when using @keyv/redis). If the client is not accessible —
   * e.g., in-memory cache fallback or future store changes — falls back to
   * explicit enumeration of all known static and common parameterised keys.
   *
   * This is intentionally conservative: only `cache:catalogs:*` keys are
   * touched, so token-blacklist and session entries are never affected.
   *
   * Limitation: parameterised keys with arbitrary IDs (e.g.,
   * `cache:catalogs:unions:country:999`) that were cached but are not in the
   * static list will only be removed by the pattern-based path.
   */
  async invalidateAll(): Promise<void> {
    this.logger.log('Cache INVALIDATE ALL — purgando todos los catálogos');

    // ── Pattern-based path (Redis SCAN) ──────────────────────────────────────
    // cache-manager wraps a Keyv store; the raw Redis client is accessible via
    // the store's internal `_redis` property when @keyv/redis is in use.
    try {
      const store = (this.cacheManager as any).store;
      // Keyv exposes the adapter via `store` on the inner stores array, or
      // directly on the top-level store object depending on the version.
      const redisClient =
        store?.stores?.[0]?.opts?.store?._redis ??
        store?.opts?.store?._redis ??
        store?.client;

      if (redisClient && typeof redisClient.keys === 'function') {
        // Use KEYS only in this controlled context (catalog namespace is small).
        // For very large catalogs a SCAN cursor loop would be preferable.
        const keys: string[] = await redisClient.keys(`${CATALOG_PREFIX}*`);
        if (keys.length > 0) {
          await redisClient.del(keys);
        }
        this.logger.log(
          `Cache INVALIDATE ALL (pattern) — ${keys.length} entradas eliminadas`,
        );
        return;
      }
    } catch (err) {
      // Pattern path unavailable — proceed to static fallback below
      this.logger.warn(
        `Pattern-based invalidation unavailable: ${this.extractMessage(err)}. Usando fallback estático.`,
      );
    }

    // ── Static fallback ───────────────────────────────────────────────────────
    // Covers all keys known at compile time plus the most common parameterised
    // variants. Keys with arbitrary IDs that are not listed here will survive
    // until their TTL expires.
    const staticKeys: string[] = [
      CATALOG_CACHE_KEYS.CLUB_TYPES,
      CATALOG_CACHE_KEYS.ACTIVITY_TYPES,
      CATALOG_CACHE_KEYS.RELATIONSHIP_TYPES,
      CATALOG_CACHE_KEYS.COUNTRIES,
      CATALOG_CACHE_KEYS.UNIONS(),
      CATALOG_CACHE_KEYS.LOCAL_FIELDS(),
      CATALOG_CACHE_KEYS.DISTRICTS(),
      CATALOG_CACHE_KEYS.CHURCHES(),
      CATALOG_CACHE_KEYS.ROLES(),
      CATALOG_CACHE_KEYS.ROLES('GLOBAL'),
      CATALOG_CACHE_KEYS.ROLES('CLUB'),
      CATALOG_CACHE_KEYS.ECCLESIASTICAL_YEARS,
      CATALOG_CACHE_KEYS.ECCLESIASTICAL_YEARS_CURRENT,
      CATALOG_CACHE_KEYS.CLUB_IDEALS(),
      CATALOG_CACHE_KEYS.ALLERGIES,
      CATALOG_CACHE_KEYS.DISEASES,
      CATALOG_CACHE_KEYS.MEDICINES,
    ];

    await Promise.allSettled(staticKeys.map((k) => this.invalidate(k)));
    this.logger.log(
      `Cache INVALIDATE ALL (static) — ${staticKeys.length} claves procesadas`,
    );
  }

  /**
   * Returns the shared catalog key prefix so callers can build
   * their own namespace-aware keys when needed.
   */
  get catalogPrefix(): string {
    return CATALOG_PREFIX;
  }

  private extractMessage(err: unknown): string {
    return err instanceof Error ? err.message : String(err);
  }
}
