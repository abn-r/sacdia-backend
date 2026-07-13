import {
  buildThrottlerOptions,
  getThrottlerTiers,
  THROTTLER_TIERS,
  THROTTLER_TIERS_DEV,
} from './throttler.config';
import { RedisThrottlerStorage } from './redis-throttler.storage';

function config(values: Record<string, string | undefined>) {
  return {
    get: jest.fn((key: string) => values[key]),
  };
}

describe('buildThrottlerOptions', () => {
  it('uses relaxed in-memory tiers in development when REDIS_URL is missing', async () => {
    await expect(
      buildThrottlerOptions(config({ NODE_ENV: 'development' })),
    ).resolves.toEqual([...THROTTLER_TIERS_DEV]);
  });

  it('uses production tiers in test when REDIS_URL is missing', async () => {
    await expect(
      buildThrottlerOptions(config({ NODE_ENV: 'test' })),
    ).resolves.toEqual([...THROTTLER_TIERS]);
  });

  it('fails startup in production when REDIS_URL is missing', async () => {
    await expect(
      buildThrottlerOptions(config({ NODE_ENV: 'production' })),
    ).rejects.toThrow('REDIS_URL is required');
  });

  it('fails startup in production when REDIS_URL is invalid', async () => {
    await expect(
      buildThrottlerOptions(
        config({ NODE_ENV: 'production', REDIS_URL: 'https://example.com' }),
      ),
    ).rejects.toThrow('redis:// or rediss://');
  });

  it('uses Redis storage when REDIS_URL is valid and reachable', async () => {
    const storage = {
      assertReady: jest.fn().mockResolvedValue(undefined),
    } as unknown as RedisThrottlerStorage;

    await expect(
      buildThrottlerOptions(
        config({ NODE_ENV: 'production', REDIS_URL: 'redis://localhost:6379' }),
        () => storage,
      ),
    ).resolves.toEqual({
      throttlers: [...THROTTLER_TIERS],
      storage,
    });

    expect(storage.assertReady).toHaveBeenCalledTimes(1);
  });
});

describe('getThrottlerTiers', () => {
  it('returns relaxed tiers only for development', () => {
    expect(getThrottlerTiers('development')).toEqual(THROTTLER_TIERS_DEV);
    expect(getThrottlerTiers('production')).toEqual(THROTTLER_TIERS);
    expect(getThrottlerTiers('test')).toEqual(THROTTLER_TIERS);
  });
});
