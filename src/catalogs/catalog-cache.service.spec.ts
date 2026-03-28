import { Test, TestingModule } from '@nestjs/testing';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import {
  CatalogCacheService,
  CATALOG_CACHE_KEYS,
} from './catalog-cache.service';
import type { Cache } from 'cache-manager';

describe('CatalogCacheService', () => {
  let service: CatalogCacheService;
  let cacheManager: jest.Mocked<Cache>;

  beforeEach(async () => {
    cacheManager = {
      get: jest.fn(),
      set: jest.fn(),
      del: jest.fn(),
    } as unknown as jest.Mocked<Cache>;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CatalogCacheService,
        {
          provide: CACHE_MANAGER,
          useValue: cacheManager,
        },
      ],
    }).compile();

    service = module.get<CatalogCacheService>(CatalogCacheService);
  });

  afterEach(() => jest.clearAllMocks());

  // -----------------------------------------------------------------------
  // getOrSet — cache HIT
  // -----------------------------------------------------------------------
  describe('getOrSet — cache HIT', () => {
    it('returns the cached value without calling the loader', async () => {
      const cached = [{ club_type_id: 1, name: 'Conquistadores' }];
      cacheManager.get.mockResolvedValue(cached);

      const loader = jest.fn();
      const result = await service.getOrSet(
        CATALOG_CACHE_KEYS.CLUB_TYPES,
        loader,
      );

      expect(result).toBe(cached);
      expect(loader).not.toHaveBeenCalled();
      expect(cacheManager.set).not.toHaveBeenCalled();
    });
  });

  // -----------------------------------------------------------------------
  // getOrSet — cache MISS
  // -----------------------------------------------------------------------
  describe('getOrSet — cache MISS', () => {
    it('calls the loader, stores the result, and returns it', async () => {
      const dbData = [{ club_type_id: 2, name: 'Aventureros' }];
      cacheManager.get.mockResolvedValue(null);
      cacheManager.set.mockResolvedValue(undefined);

      const loader = jest.fn().mockResolvedValue(dbData);
      const result = await service.getOrSet(
        CATALOG_CACHE_KEYS.CLUB_TYPES,
        loader,
      );

      expect(result).toBe(dbData);
      expect(loader).toHaveBeenCalledTimes(1);
      expect(cacheManager.set).toHaveBeenCalledWith(
        CATALOG_CACHE_KEYS.CLUB_TYPES,
        dbData,
        3_600_000,
      );
    });

    it('respects a custom TTL', async () => {
      cacheManager.get.mockResolvedValue(undefined);
      cacheManager.set.mockResolvedValue(undefined);
      const loader = jest.fn().mockResolvedValue([]);

      await service.getOrSet('some-key', loader, 1_800_000);

      expect(cacheManager.set).toHaveBeenCalledWith('some-key', [], 1_800_000);
    });
  });

  // -----------------------------------------------------------------------
  // getOrSet — Redis failure graceful fallback
  // -----------------------------------------------------------------------
  describe('getOrSet — Redis GET failure', () => {
    it('falls back to the loader when Redis throws on GET', async () => {
      const dbData = [{ country_id: 1, name: 'Argentina' }];
      cacheManager.get.mockRejectedValue(new Error('Redis connection refused'));
      cacheManager.set.mockRejectedValue(new Error('Redis connection refused'));

      const loader = jest.fn().mockResolvedValue(dbData);
      const result = await service.getOrSet(
        CATALOG_CACHE_KEYS.COUNTRIES,
        loader,
      );

      expect(result).toBe(dbData);
      expect(loader).toHaveBeenCalledTimes(1);
    });
  });

  // -----------------------------------------------------------------------
  // invalidate
  // -----------------------------------------------------------------------
  describe('invalidate', () => {
    it('calls cacheManager.del with the given key', async () => {
      cacheManager.del.mockResolvedValue(true);

      await service.invalidate(CATALOG_CACHE_KEYS.ALLERGIES);

      expect(cacheManager.del).toHaveBeenCalledWith(
        CATALOG_CACHE_KEYS.ALLERGIES,
      );
    });

    it('does not throw when Redis del fails', async () => {
      cacheManager.del.mockRejectedValue(new Error('Redis down'));

      await expect(
        service.invalidate(CATALOG_CACHE_KEYS.ALLERGIES),
      ).resolves.not.toThrow();
    });
  });

  // -----------------------------------------------------------------------
  // invalidateMany
  // -----------------------------------------------------------------------
  describe('invalidateMany', () => {
    it('deletes all provided keys', async () => {
      cacheManager.del.mockResolvedValue(true);
      const keys = [
        CATALOG_CACHE_KEYS.ECCLESIASTICAL_YEARS,
        CATALOG_CACHE_KEYS.ECCLESIASTICAL_YEARS_CURRENT,
      ];

      await service.invalidateMany(keys);

      expect(cacheManager.del).toHaveBeenCalledTimes(2);
      expect(cacheManager.del).toHaveBeenCalledWith(keys[0]);
      expect(cacheManager.del).toHaveBeenCalledWith(keys[1]);
    });

    it('continues when some keys fail', async () => {
      cacheManager.del
        .mockResolvedValueOnce(true)
        .mockRejectedValueOnce(new Error('Redis down'));

      await expect(
        service.invalidateMany([
          CATALOG_CACHE_KEYS.ECCLESIASTICAL_YEARS,
          CATALOG_CACHE_KEYS.ECCLESIASTICAL_YEARS_CURRENT,
        ]),
      ).resolves.not.toThrow();
    });
  });

  // -----------------------------------------------------------------------
  // invalidateAll
  // -----------------------------------------------------------------------
  describe('invalidateAll', () => {
    it('deletes all known static catalog keys', async () => {
      cacheManager.del.mockResolvedValue(true);

      await service.invalidateAll();

      // Verify the most important keys are included
      expect(cacheManager.del).toHaveBeenCalledWith(
        CATALOG_CACHE_KEYS.CLUB_TYPES,
      );
      expect(cacheManager.del).toHaveBeenCalledWith(
        CATALOG_CACHE_KEYS.COUNTRIES,
      );
      expect(cacheManager.del).toHaveBeenCalledWith(
        CATALOG_CACHE_KEYS.ALLERGIES,
      );
      expect(cacheManager.del).toHaveBeenCalledWith(
        CATALOG_CACHE_KEYS.DISEASES,
      );
      expect(cacheManager.del).toHaveBeenCalledWith(
        CATALOG_CACHE_KEYS.ECCLESIASTICAL_YEARS,
      );
      expect(cacheManager.del).toHaveBeenCalledWith(
        CATALOG_CACHE_KEYS.ECCLESIASTICAL_YEARS_CURRENT,
      );
    });
  });

  // -----------------------------------------------------------------------
  // CATALOG_CACHE_KEYS helpers
  // -----------------------------------------------------------------------
  describe('CATALOG_CACHE_KEYS key builders', () => {
    it('builds union key without filter', () => {
      expect(CATALOG_CACHE_KEYS.UNIONS()).toBe('cache:catalogs:unions:all');
    });

    it('builds union key with countryId', () => {
      expect(CATALOG_CACHE_KEYS.UNIONS(3)).toBe(
        'cache:catalogs:unions:country:3',
      );
    });

    it('builds roles key without category', () => {
      expect(CATALOG_CACHE_KEYS.ROLES()).toBe('cache:catalogs:roles:all');
    });

    it('builds roles key with category', () => {
      expect(CATALOG_CACHE_KEYS.ROLES('GLOBAL')).toBe(
        'cache:catalogs:roles:global',
      );
    });

    it('local fields key without filter', () => {
      expect(CATALOG_CACHE_KEYS.LOCAL_FIELDS()).toBe(
        'cache:catalogs:local_fields:all',
      );
    });

    it('local fields key with unionId', () => {
      expect(CATALOG_CACHE_KEYS.LOCAL_FIELDS(7)).toBe(
        'cache:catalogs:local_fields:union:7',
      );
    });
  });
});
