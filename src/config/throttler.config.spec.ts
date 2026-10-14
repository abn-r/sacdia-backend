import { Logger } from '@nestjs/common';
import {
  buildThrottlerOptions,
  getThrottlerTiers,
  THROTTLER_READINESS_TIMEOUT_MS,
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

  it.each([
    [undefined, false],
    ['true', true],
    [true, true],
    ['false', false],
    [false, false],
  ])(
    'passes failOpen for THROTTLER_FAIL_OPEN=%p as %p',
    async (raw, expected) => {
      const storage = {
        assertReady: jest.fn().mockResolvedValue(undefined),
      } as unknown as RedisThrottlerStorage;
      const factory = jest.fn(() => storage);

      await buildThrottlerOptions(
        {
          get: jest.fn(
            (key: string) =>
              ({
                NODE_ENV: 'production',
                REDIS_URL: 'redis://localhost:6379',
                THROTTLER_FAIL_OPEN: raw,
              })[key],
          ),
        },
        factory,
      );

      expect(factory).toHaveBeenCalledWith('redis://localhost:6379', {
        failOpen: expected,
      });
    },
  );
});

describe('buildThrottlerOptions readiness and REDIS_BOOT_OPTIONAL', () => {
  const baseEnv = {
    NODE_ENV: 'production',
    REDIS_URL: 'redis://localhost:6379',
  };

  function configWith(values: Record<string, unknown>) {
    return { get: jest.fn((key: string) => values[key]) };
  }

  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('fails startup in production when the readiness check rejects (flag off)', async () => {
    const storage = {
      assertReady: jest.fn().mockRejectedValue(new Error('ECONNREFUSED')),
    } as unknown as RedisThrottlerStorage;

    await expect(
      buildThrottlerOptions(configWith(baseEnv), () => storage),
    ).rejects.toThrow('Redis throttler connection failed: ECONNREFUSED');
  });

  it('times out a readiness check that never settles and fails startup (flag off)', async () => {
    jest.useFakeTimers();
    const storage = {
      assertReady: jest.fn(() => new Promise<void>(() => undefined)),
    } as unknown as RedisThrottlerStorage;

    const result = buildThrottlerOptions(configWith(baseEnv), () => storage);
    const assertion = expect(result).rejects.toThrow(
      `readiness check timed out after ${THROTTLER_READINESS_TIMEOUT_MS} ms`,
    );
    await jest.advanceTimersByTimeAsync(THROTTLER_READINESS_TIMEOUT_MS);

    await assertion;
  });

  it.each([true, 'true'])(
    'keeps the Redis storage and boots when readiness times out with REDIS_BOOT_OPTIONAL=%p',
    async (flag) => {
      jest.useFakeTimers();
      const storage = {
        assertReady: jest.fn(() => new Promise<void>(() => undefined)),
      } as unknown as RedisThrottlerStorage;

      const result = buildThrottlerOptions(
        configWith({ ...baseEnv, REDIS_BOOT_OPTIONAL: flag }),
        () => storage,
      );
      await jest.advanceTimersByTimeAsync(THROTTLER_READINESS_TIMEOUT_MS);

      await expect(result).resolves.toEqual({
        throttlers: [...THROTTLER_TIERS],
        storage,
      });
      expect(Logger.prototype.error).toHaveBeenCalledWith(
        expect.stringContaining('REDIS_BOOT_OPTIONAL=true'),
      );
    },
  );

  it('keeps the Redis storage and boots when readiness rejects with the flag on', async () => {
    const storage = {
      assertReady: jest.fn().mockRejectedValue(new Error('ECONNREFUSED')),
    } as unknown as RedisThrottlerStorage;

    await expect(
      buildThrottlerOptions(
        configWith({ ...baseEnv, REDIS_BOOT_OPTIONAL: true }),
        () => storage,
      ),
    ).resolves.toEqual({ throttlers: [...THROTTLER_TIERS], storage });
  });

  it('still fails when REDIS_URL is missing even with the flag on', async () => {
    await expect(
      buildThrottlerOptions(
        configWith({ NODE_ENV: 'production', REDIS_BOOT_OPTIONAL: true }),
      ),
    ).rejects.toThrow('REDIS_URL is required');
  });
});

describe('getThrottlerTiers', () => {
  it('returns relaxed tiers only for development', () => {
    expect(getThrottlerTiers('development')).toEqual(THROTTLER_TIERS_DEV);
    expect(getThrottlerTiers('production')).toEqual(THROTTLER_TIERS);
    expect(getThrottlerTiers('test')).toEqual(THROTTLER_TIERS);
  });
});
