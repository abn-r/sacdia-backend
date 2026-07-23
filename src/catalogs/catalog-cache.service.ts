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
type UnionCacheFilter =
  | number
  | {
      countryId?: number;
      divisionId?: number;
    };

export const CATALOG_CACHE_KEYS = {
  CLUB_TYPES: 'cache:catalogs:club_types',
  ACTIVITY_TYPES: 'cache:catalogs:activity_types',
  RELATIONSHIP_TYPES: 'cache:catalogs:relationship_types',
  COUNTRIES: 'cache:catalogs:countries',
  DIVISIONS: 'cache:catalogs:divisions',
  UNIONS: (filter?: UnionCacheFilter) => {
    if (typeof filter === 'number') {
      return `cache:catalogs:unions:country:${filter}`;
    }
    if (filter?.countryId && filter?.divisionId) {
      return `cache:catalogs:unions:division:${filter.divisionId}:country:${filter.countryId}`;
    }
    if (filter?.divisionId) {
      return `cache:catalogs:unions:division:${filter.divisionId}`;
    }
    if (filter?.countryId) {
      return `cache:catalogs:unions:country:${filter.countryId}`;
    }
    return 'cache:catalogs:unions:all';
  },
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
  ECCLESIASTICAL_YEARS_CURRENT:
    'cache:catalogs:ecclesiastical_years:v2:current',
  CLUB_IDEALS: (clubTypeId?: number) =>
    clubTypeId
      ? `cache:catalogs:club_ideals:type:${clubTypeId}`
      : 'cache:catalogs:club_ideals:all',
  ALLERGIES: 'cache:catalogs:allergies',
  DISEASES: 'cache:catalogs:diseases',
  MEDICINES: 'cache:catalogs:medicines',
  CAMPOREE_EVENT_TYPES: 'cache:catalogs:camporee_event_types',
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

export interface CatalogCacheMetrics {
  hits: number;
  misses: number;
  coalescedLoads: number;
  errors: number;
  invalidations: number;
}

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
  private readonly inFlightLoads = new Map<string, Promise<unknown>>();
  private readonly metrics: CatalogCacheMetrics = {
    hits: 0,
    misses: 0,
    coalescedLoads: 0,
    errors: 0,
    invalidations: 0,
  };

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
        this.metrics.hits += 1;
        this.logger.debug(`Cache HIT  — ${key}`);
        return cached;
      }
    } catch (err) {
      // Redis down or serialization error — degrade gracefully
      this.metrics.errors += 1;
      this.logger.warn(
        `Cache GET fallido para "${key}": ${this.extractMessage(err)}`,
      );
    }

    this.metrics.misses += 1;
    this.logger.debug(`Cache MISS — ${key}`);
    const inFlight = this.inFlightLoads.get(key) as Promise<T> | undefined;
    if (inFlight) {
      this.metrics.coalescedLoads += 1;
      return inFlight;
    }

    const load = this.loadAndCache(key, loader, ttlMs);
    this.inFlightLoads.set(key, load);

    try {
      return await load;
    } finally {
      if (this.inFlightLoads.get(key) === load) {
        this.inFlightLoads.delete(key);
      }
    }
  }

  /**
   * Invalidate a single catalog cache key.
   *
   * @param key - The exact cache key to remove
   */
  async invalidate(key: string): Promise<void> {
    try {
      await this.cacheManager.del(key);
      this.metrics.invalidations += 1;
      this.logger.log(`Cache INVALIDATED — ${key}`);
    } catch (err) {
      this.metrics.errors += 1;
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
   * Strategy: enumerate keys through CacheManager's public Keyv store iterator
   * (Redis uses SCAN under the hood). If the configured store cannot iterate,
   * fall back to explicit enumeration of known keys.
   *
   * This is intentionally conservative: only `cache:catalogs:*` keys are
   * touched, so token-blacklist and session entries are never affected.
   *
   * Limitation: parameterised keys with arbitrary IDs are only guaranteed to
   * be removed when the configured store supports iteration.
   */
  async invalidateAll(): Promise<void> {
    this.logger.log('Cache INVALIDATE ALL — purgando todos los catálogos');

    const iteratedKeys = await this.findCatalogKeys();
    if (iteratedKeys !== null) {
      try {
        if (iteratedKeys.length > 0) {
          await this.cacheManager.mdel(iteratedKeys);
          this.metrics.invalidations += iteratedKeys.length;
        }
        this.logger.log(
          `Cache INVALIDATE ALL (iterator) — ${iteratedKeys.length} entradas eliminadas`,
        );
        return;
      } catch (err) {
        this.metrics.errors += 1;
        this.logger.warn(
          `Iterator-based invalidation failed: ${this.extractMessage(err)}. Usando fallback estático.`,
        );
      }
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
      CATALOG_CACHE_KEYS.DIVISIONS,
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
      CATALOG_CACHE_KEYS.CAMPOREE_EVENT_TYPES,
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

  getMetrics(): CatalogCacheMetrics {
    return { ...this.metrics };
  }

  private async loadAndCache<T>(
    key: string,
    loader: () => Promise<T>,
    ttlMs: number,
  ): Promise<T> {
    const data = await loader();

    try {
      await this.cacheManager.set(key, data, ttlMs);
      this.logger.debug(`Cache SET  — ${key} (TTL ${ttlMs}ms)`);
    } catch (err) {
      this.metrics.errors += 1;
      this.logger.warn(
        `Cache SET fallido para "${key}": ${this.extractMessage(err)}`,
      );
    }

    return data;
  }

  private async findCatalogKeys(): Promise<string[] | null> {
    const keys = new Set<string>();
    let supportsIteration = false;

    try {
      for (const store of this.cacheManager.stores ?? []) {
        if (typeof store.iterator !== 'function') continue;
        supportsIteration = true;

        for await (const entry of store.iterator(store.namespace)) {
          const key = entry[0];
          if (typeof key === 'string' && key.startsWith(CATALOG_PREFIX)) {
            keys.add(key);
          }
        }
      }
    } catch (err) {
      this.metrics.errors += 1;
      this.logger.warn(
        `Cache iteration failed: ${this.extractMessage(err)}. Usando fallback estático.`,
      );
      return null;
    }

    return supportsIteration ? [...keys] : null;
  }

  private extractMessage(err: unknown): string {
    return err instanceof Error ? err.message : String(err);
  }
}
