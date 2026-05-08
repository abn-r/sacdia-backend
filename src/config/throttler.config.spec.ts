import { buildThrottlerOptions, THROTTLER_TIERS } from './throttler.config';
import { RedisThrottlerStorage } from './redis-throttler.storage';

function config(values: Record<string, string | undefined>) {
  return {
    get: jest.fn((key: string) => values[key]),
  };
}

describe('buildThrottlerOptions', () => {
  it('uses in-memory tiers outside production when REDIS_URL is missing', async () => {
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
