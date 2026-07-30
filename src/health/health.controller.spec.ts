jest.mock('../config/firebase-admin.module', () => ({
  firebaseAdmin: {
    getApps: jest.fn(() => ['mock-app']),
    getMessaging: jest.fn(),
  },
}));

import type { Cache } from 'cache-manager';
import { CatalogCacheService } from '../catalogs/catalog-cache.service';
import { PrismaService } from '../prisma/prisma.service';
import { HealthController } from './health.controller';

describe('HealthController', () => {
  const poolMetrics = {
    max: 20,
    total: 6,
    idle: 2,
    active: 4,
    waiting: 1,
    utilization: 0.2,
  };
  const catalogMetrics = {
    hits: 10,
    misses: 2,
    coalescedLoads: 1,
    errors: 0,
    invalidations: 3,
  };

  function createController(cacheValue: string | undefined = 'ok') {
    const prisma = {
      $queryRaw: jest.fn().mockResolvedValue([{ '?column?': 1 }]),
      getPoolMetrics: jest.fn().mockReturnValue(poolMetrics),
    } as unknown as PrismaService;
    const cacheManager = {
      set: jest.fn().mockResolvedValue('ok'),
      get: jest.fn().mockResolvedValue(cacheValue),
      del: jest.fn().mockResolvedValue(true),
    } as unknown as Cache;
    const catalogCache = {
      getMetrics: jest.fn().mockReturnValue(catalogMetrics),
    } as unknown as CatalogCacheService;

    return {
      controller: new HealthController(prisma, cacheManager, catalogCache),
      cacheManager,
    };
  }

  it('reports pool and catalog-cache operational metrics', async () => {
    const { controller, cacheManager } = createController();

    const result = await controller.details();

    expect(result).toMatchObject({
      status: 'ok',
      dependencies: {
        database: { ok: true, pool: poolMetrics },
        cache: { ok: true, catalogs: catalogMetrics },
        fcm: { initialized: true },
      },
    });
    expect(cacheManager.del).toHaveBeenCalledWith(expect.any(String));
  });

  it('marks the system degraded when cache verification fails', async () => {
    const { controller } = createController('unexpected');

    await expect(controller.details()).resolves.toMatchObject({
      status: 'degraded',
      dependencies: {
        database: { ok: true },
        cache: { ok: false },
      },
    });
  });
});
