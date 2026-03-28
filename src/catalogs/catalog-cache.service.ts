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
  ECCLESIASTICAL_YEARS: 'cache:catalogs:ecclesiastical_years',
  ECCLESIASTICAL_YEARS_CURRENT: 'cache:catalogs:ecclesiastical_years:current',
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
   * cache-manager v5/v6 does not expose a SCAN-based prefix delete on all
   * stores. The reliable approach is to enumerate the known static keys
   * plus a set of common parameterised variants and delete them all.
   *
   * This is intentionally conservative — it only touches `cache:catalogs:*`
   * keys and will never remove token-blacklist or session entries.
   */
  async invalidateAll(): Promise<void> {
    this.logger.log('Cache INVALIDATE ALL — purgando todos los catálogos');

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
