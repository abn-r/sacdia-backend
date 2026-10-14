import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  buildCacheOptions,
  RedisCacheStoreFactory,
  UnverifiedRedisCacheStoreFactory,
} from './cache.config';

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
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
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

  describe('REDIS_BOOT_OPTIONAL', () => {
    const redisUrl = 'redis://localhost:6379';

    function failingProbe() {
      return jest
        .fn<RedisCacheStoreFactory>()
        .mockRejectedValue(new Error('connection refused'));
    }

    it.each([undefined, false, 'false'])(
      'still fails startup in production with REDIS_BOOT_OPTIONAL=%p',
      async (flag) => {
        const unverified = jest.fn<UnverifiedRedisCacheStoreFactory>();

        await expect(
          buildCacheOptions(
            createConfig({
              NODE_ENV: 'production',
              REDIS_URL: redisUrl,
              REDIS_BOOT_OPTIONAL: flag,
            }),
            failingProbe(),
            unverified,
          ),
        ).rejects.toThrow('Redis cache connection failed: connection refused');
        expect(unverified).not.toHaveBeenCalled();
      },
    );

    it.each([true, 'true'])(
      'boots in production with an unverified Redis store when the probe fails (flag=%p)',
      async (flag) => {
        const lazyStore = { name: 'lazy-redis-store' };
        const unverified = jest
          .fn<UnverifiedRedisCacheStoreFactory>()
          .mockReturnValue(lazyStore as never);

        const options = await buildCacheOptions(
          createConfig({
            NODE_ENV: 'production',
            REDIS_URL: redisUrl,
            REDIS_BOOT_OPTIONAL: flag,
            CACHE_DEFAULT_TTL_MS: 60_000,
            CACHE_REDIS_CONNECTION_TIMEOUT_MS: 3_000,
          }),
          failingProbe(),
          unverified,
        );

        // Keeps the Redis store (no silent switch to in-memory) so it
        // reconnects when Redis returns.
        expect(options).toEqual({ stores: [lazyStore], ttl: 60_000 });
        expect(unverified).toHaveBeenCalledWith(redisUrl, 3_000);
        expect(Logger.prototype.error).toHaveBeenCalledWith(
          expect.stringContaining('REDIS_BOOT_OPTIONAL=true'),
        );
      },
    );

    it('still fails when REDIS_URL is missing even with the flag on', async () => {
      await expect(
        buildCacheOptions(
          createConfig({ NODE_ENV: 'production', REDIS_BOOT_OPTIONAL: true }),
        ),
      ).rejects.toThrow('REDIS_URL is required');
    });

    it('does not touch the unverified factory when the probe succeeds', async () => {
      const redisStore = { name: 'redis-store' };
      const unverified = jest.fn<UnverifiedRedisCacheStoreFactory>();

      const options = await buildCacheOptions(
        createConfig({
          NODE_ENV: 'production',
          REDIS_URL: redisUrl,
          REDIS_BOOT_OPTIONAL: true,
        }),
        jest
          .fn<RedisCacheStoreFactory>()
          .mockResolvedValue(redisStore as never),
        unverified,
      );

      expect(options).toEqual({ stores: [redisStore], ttl: 86_400_000 });
      expect(unverified).not.toHaveBeenCalled();
    });
  });
});
