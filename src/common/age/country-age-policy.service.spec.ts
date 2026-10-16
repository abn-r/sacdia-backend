import { Test, TestingModule } from '@nestjs/testing';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { CatalogCacheService } from '../../catalogs/catalog-cache.service';
import { PrismaService } from '../../prisma/prisma.service';
import {
  CountryAgePolicyService,
  DEFAULT_COUNTRY_AGE_POLICY,
} from './country-age-policy.service';

describe('CountryAgePolicyService', () => {
  let service: CountryAgePolicyService;
  let cacheManager: { get: jest.Mock; set: jest.Mock; del: jest.Mock };
  let prisma: { countries: { findUnique: jest.Mock } };

  beforeEach(async () => {
    cacheManager = {
      get: jest.fn().mockResolvedValue(undefined),
      set: jest.fn().mockResolvedValue(undefined),
      del: jest.fn().mockResolvedValue(undefined),
    };
    prisma = { countries: { findUnique: jest.fn() } };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CountryAgePolicyService,
        CatalogCacheService,
        { provide: PrismaService, useValue: prisma },
        { provide: CACHE_MANAGER, useValue: cacheManager },
      ],
    }).compile();

    service = module.get(CountryAgePolicyService);
  });

  it('returns the code defaults (13 / 18 / America/Mexico_City) without country', async () => {
    await expect(service.getPolicy(null)).resolves.toEqual({
      minSelfLoginAge: 13,
      ageOfMajority: 18,
      timeZone: 'America/Mexico_City',
    });
    await expect(service.getPolicy(undefined)).resolves.toEqual(
      DEFAULT_COUNTRY_AGE_POLICY,
    );
    expect(prisma.countries.findUnique).not.toHaveBeenCalled();
    expect(cacheManager.get).not.toHaveBeenCalled();
  });

  it('reads the country row and caches it under the policy key with a 1h TTL', async () => {
    prisma.countries.findUnique.mockResolvedValue({
      minor_self_login_min_age: 16,
      age_of_majority: 21,
      age_reference_timezone: 'America/Bogota',
    });

    const policy = await service.getPolicy(7);

    expect(policy).toEqual({
      minSelfLoginAge: 16,
      ageOfMajority: 21,
      timeZone: 'America/Bogota',
    });
    expect(cacheManager.get).toHaveBeenCalledWith(
      'cache:catalogs:country_age_policy:7',
    );
    expect(cacheManager.set).toHaveBeenCalledWith(
      'cache:catalogs:country_age_policy:7',
      policy,
      3_600_000,
    );
  });

  it('defaults the time zone when the country has none', async () => {
    prisma.countries.findUnique.mockResolvedValue({
      minor_self_login_min_age: 13,
      age_of_majority: 18,
      age_reference_timezone: null,
    });

    await expect(service.getPolicy(1)).resolves.toEqual(
      DEFAULT_COUNTRY_AGE_POLICY,
    );
  });

  it('falls back to defaults when the country row is missing', async () => {
    prisma.countries.findUnique.mockResolvedValue(null);

    await expect(service.getPolicy(999)).resolves.toEqual(
      DEFAULT_COUNTRY_AGE_POLICY,
    );
  });

  it('serves a cache hit without touching the database', async () => {
    const cached = {
      minSelfLoginAge: 14,
      ageOfMajority: 19,
      timeZone: 'UTC',
    };
    cacheManager.get.mockResolvedValue(cached);

    await expect(service.getPolicy(3)).resolves.toBe(cached);
    expect(prisma.countries.findUnique).not.toHaveBeenCalled();
  });

  it('falls back to the database when Redis fails on read and on write', async () => {
    cacheManager.get.mockRejectedValue(new Error('redis down'));
    cacheManager.set.mockRejectedValue(new Error('redis down'));
    prisma.countries.findUnique.mockResolvedValue({
      minor_self_login_min_age: 15,
      age_of_majority: 18,
      age_reference_timezone: null,
    });

    await expect(service.getPolicy(5)).resolves.toEqual({
      minSelfLoginAge: 15,
      ageOfMajority: 18,
      timeZone: 'America/Mexico_City',
    });
    expect(prisma.countries.findUnique).toHaveBeenCalledTimes(1);
  });

  it('invalidates the cached policy of one country', async () => {
    await service.invalidate(7);

    expect(cacheManager.del).toHaveBeenCalledWith(
      'cache:catalogs:country_age_policy:7',
    );
  });
});
