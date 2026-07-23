import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { buildCacheOptions, RedisCacheStoreFactory } from './cache.config';

function createConfig(values: Record<string, unknown>): ConfigService {
  return {
    get: jest.fn((key: string, defaultValue?: unknown) =>
      Object.prototype.hasOwnProperty.call(values, key)
        ? values[key]
        : defaultValue,
    ),
  } as unknown as ConfigService;
}

describe('buildCacheOptions', () => {
  beforeAll(() => {
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  });

  afterAll(() => {
    jest.restoreAllMocks();
  });

  it('uses an in-memory cache in development when Redis is not configured', async () => {
    const redisFactory = jest.fn<RedisCacheStoreFactory>();

    await expect(
      buildCacheOptions(
        createConfig({ NODE_ENV: 'development' }),
        redisFactory,
      ),
    ).resolves.toEqual({ ttl: 86_400_000 });
    expect(redisFactory).not.toHaveBeenCalled();
  });

  it('fails startup in production when Redis is not configured', async () => {
    await expect(
      buildCacheOptions(createConfig({ NODE_ENV: 'production' })),
    ).rejects.toThrow('REDIS_URL is required');
  });

  it('rejects non-Redis URL schemes before creating a store', async () => {
    const redisFactory = jest.fn<RedisCacheStoreFactory>();

    await expect(
      buildCacheOptions(
        createConfig({
          NODE_ENV: 'production',
          REDIS_URL: 'https://redis.example.com',
        }),
        redisFactory,
      ),
    ).rejects.toThrow('redis:// or rediss://');
    expect(redisFactory).not.toHaveBeenCalled();
  });

  it('verifies Redis and returns the connected store', async () => {
    const redisStore = { name: 'redis-store' };
    const redisFactory = jest
      .fn<RedisCacheStoreFactory>()
      .mockResolvedValue(redisStore);

    const options = await buildCacheOptions(
      createConfig({
        NODE_ENV: 'production',
        REDIS_URL: 'rediss://default:secret@redis.example.com:6379',
        CACHE_DEFAULT_TTL_MS: 60_000,
        CACHE_REDIS_CONNECTION_TIMEOUT_MS: 3_000,
      }),
      redisFactory,
    );

    expect(redisFactory).toHaveBeenCalledWith(
      'rediss://default:secret@redis.example.com:6379',
      3_000,
    );
    expect(options).toEqual({ stores: [redisStore], ttl: 60_000 });
  });

  it('fails startup in production when Redis cannot be reached', async () => {
    const redisFactory = jest
      .fn<RedisCacheStoreFactory>()
      .mockRejectedValue(new Error('connection refused'));

    await expect(
      buildCacheOptions(
        createConfig({
          NODE_ENV: 'production',
          REDIS_URL: 'redis://localhost:6379',
        }),
        redisFactory,
      ),
    ).rejects.toThrow('Redis cache connection failed: connection refused');
  });

  it('falls back to memory in development when Redis cannot be reached', async () => {
    const redisFactory = jest
      .fn<RedisCacheStoreFactory>()
      .mockRejectedValue(new Error('connection refused'));

    await expect(
      buildCacheOptions(
        createConfig({
          NODE_ENV: 'development',
          REDIS_URL: 'redis://localhost:6379',
        }),
        redisFactory,
      ),
    ).resolves.toEqual({ ttl: 86_400_000 });
  });
});
