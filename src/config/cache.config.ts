import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { CacheModuleOptions } from '@nestjs/cache-manager';
import { createKeyv, type Keyv } from '@keyv/redis';
import { isPlaceholderUrl } from './bullmq.config';
import { isRedisBootOptional } from './redis-degraded.config';

const DEFAULT_CACHE_TTL_MS = 86_400_000;
const DEFAULT_REDIS_CONNECTION_TIMEOUT_MS = 5_000;
const CACHE_BOOTSTRAP_PROBE_KEY = 'health:cache:bootstrap';
const logger = new Logger('CacheConfig');

export type RedisCacheStoreFactory = (
  redisUrl: string,
  connectionTimeoutMs: number,
) => Promise<Keyv>;

/**
 * Builds a Keyv Redis store WITHOUT probing it. Keyv connects lazily on first
 * use and retries on every call, so a store created while Redis is down
 * recovers by itself once Redis is back.
 */
export type UnverifiedRedisCacheStoreFactory = (
  redisUrl: string,
  connectionTimeoutMs: number,
) => Keyv;

export const createUnverifiedRedisCacheStore: UnverifiedRedisCacheStoreFactory =
  (redisUrl, connectionTimeoutMs) =>
    createKeyv(redisUrl, {
      connectionTimeout: connectionTimeoutMs,
      throwOnConnectError: true,
      throwOnErrors: true,
    });

export const createRedisCacheStore: RedisCacheStoreFactory = async (
  redisUrl,
  connectionTimeoutMs,
) => {
  const store = createUnverifiedRedisCacheStore(redisUrl, connectionTimeoutMs);

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
  unverifiedStoreFactory: UnverifiedRedisCacheStoreFactory = createUnverifiedRedisCacheStore,
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
  const bootOptional = isRedisBootOptional(
    configService.get('REDIS_BOOT_OPTIONAL'),
  );

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
    if (isProduction && bootOptional) {
      // REDIS_BOOT_OPTIONAL: boot anyway, but keep the Redis store (never
      // swap production to a per-process in-memory cache silently). Keyv
      // reconnects on the next call once Redis is reachable again.
      logger.error(
        `Redis cache connection failed: ${message}. REDIS_BOOT_OPTIONAL=true: starting WITHOUT a verified cache connection; the Redis store will reconnect when Redis returns, and cache reads/writes fail (and fall back to the database) until then.`,
      );
      return {
        stores: [unverifiedStoreFactory(redisUrl, connectionTimeoutMs)],
        ttl,
      };
    }
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
