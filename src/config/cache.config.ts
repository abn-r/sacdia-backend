import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { CacheModuleOptions } from '@nestjs/cache-manager';
import { createKeyv, type Keyv } from '@keyv/redis';
import { isPlaceholderUrl } from './bullmq.config';

const DEFAULT_CACHE_TTL_MS = 86_400_000;
const DEFAULT_REDIS_CONNECTION_TIMEOUT_MS = 5_000;
const CACHE_BOOTSTRAP_PROBE_KEY = 'health:cache:bootstrap';
const logger = new Logger('CacheConfig');

export type RedisCacheStoreFactory = (
  redisUrl: string,
  connectionTimeoutMs: number,
) => Promise<Keyv>;

export const createRedisCacheStore: RedisCacheStoreFactory = async (
  redisUrl,
  connectionTimeoutMs,
) => {
  const store = createKeyv(redisUrl, {
    connectionTimeout: connectionTimeoutMs,
    throwOnConnectError: true,
    throwOnErrors: true,
  });

  try {
    // Keyv connects lazily. A real read verifies DNS, TLS, authentication and
    // server availability before Nest finishes bootstrapping.
    await store.get(CACHE_BOOTSTRAP_PROBE_KEY);
    return store;
  } catch (error) {
    await store.disconnect().catch(() => undefined);
    throw error;
  }
};

export async function buildCacheOptions(
  configService: ConfigService,
  redisStoreFactory: RedisCacheStoreFactory = createRedisCacheStore,
): Promise<CacheModuleOptions> {
  const environment = configService.get<string>('NODE_ENV', 'development');
  const isProduction = environment === 'production';
  const ttl = configService.get<number>(
    'CACHE_DEFAULT_TTL_MS',
    DEFAULT_CACHE_TTL_MS,
  );
  const connectionTimeoutMs = configService.get<number>(
    'CACHE_REDIS_CONNECTION_TIMEOUT_MS',
    DEFAULT_REDIS_CONNECTION_TIMEOUT_MS,
  );
  const redisUrl = configService.get<string>('REDIS_URL')?.trim();

  if (!redisUrl || isPlaceholderUrl(redisUrl)) {
    return handleRedisUnavailable(
      isProduction,
      ttl,
      'REDIS_URL is required for distributed caching in production.',
    );
  }

  if (!isRedisUrl(redisUrl)) {
    return handleRedisUnavailable(
      isProduction,
      ttl,
      'REDIS_URL must be a valid redis:// or rediss:// URL for caching.',
    );
  }

  try {
    const store = await redisStoreFactory(redisUrl, connectionTimeoutMs);
    logger.log('Redis cache connection verified');
    return { stores: [store], ttl };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return handleRedisUnavailable(
      isProduction,
      ttl,
      `Redis cache connection failed: ${message}`,
    );
  }
}

function handleRedisUnavailable(
  isProduction: boolean,
  ttl: number,
  reason: string,
): CacheModuleOptions {
  if (isProduction) {
    throw new Error(reason);
  }

  logger.warn(`${reason} Using in-memory cache for local development.`);
  return { ttl };
}

function isRedisUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'redis:' || url.protocol === 'rediss:';
  } catch {
    return false;
  }
}
