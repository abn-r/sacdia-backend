import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type {
  ThrottlerModuleOptions,
  ThrottlerOptions,
} from '@nestjs/throttler';
import { withTimeout } from '../common/utils/with-timeout';
import { isPlaceholderUrl } from './bullmq.config';
import {
  isRedisBootOptional,
  resolveThrottlerFallback,
} from './redis-degraded.config';
import {
  RedisThrottlerStorage,
  type RedisThrottlerStorageOptions,
} from './redis-throttler.storage';

const logger = new Logger('ThrottlerConfig');

/** Upper bound for the boot-time Redis readiness check (connect + PING). */
export const THROTTLER_READINESS_TIMEOUT_MS = 5_000;

export const THROTTLER_TIERS = [
  {
    name: 'short',
    ttl: 1000, // 1 segundo
    limit: 3, // 3 requests por segundo
  },
  {
    name: 'medium',
    ttl: 10000, // 10 segundos
    limit: 20, // 20 requests por 10 segundos
  },
  {
    name: 'long',
    ttl: 60000, // 1 minuto
    limit: 100, // 100 requests por minuto
  },
] as const;

/** Relaxed limits for local dev (Next.js fires many parallel server fetches). */
export const THROTTLER_TIERS_DEV = [
  {
    name: 'short',
    ttl: 1000,
    limit: 30,
  },
  {
    name: 'medium',
    ttl: 10000,
    limit: 200,
  },
  {
    name: 'long',
    ttl: 60000,
    limit: 1000,
  },
] as const;

export function getThrottlerTiers(nodeEnv: string | undefined) {
  return nodeEnv === 'development' ? THROTTLER_TIERS_DEV : THROTTLER_TIERS;
}

type RedisStorageFactory = (
  redisUrl: string,
  options: RedisThrottlerStorageOptions,
) => RedisThrottlerStorage;
type ConfigReader = Pick<ConfigService, 'get'>;

export async function buildThrottlerOptions(
  configService: ConfigReader,
  createStorage: RedisStorageFactory = (redisUrl, options) =>
    new RedisThrottlerStorage(redisUrl, options),
): Promise<ThrottlerModuleOptions> {
  const nodeEnv = configService.get<string>('NODE_ENV') ?? 'development';
  const isProduction = nodeEnv === 'production';
  const throttlers = [...getThrottlerTiers(nodeEnv)];
  const redisUrl = configService.get<string>('REDIS_URL')?.trim();
  const bootOptional = isRedisBootOptional(
    configService.get('REDIS_BOOT_OPTIONAL'),
  );

  if (!redisUrl || isPlaceholderUrl(redisUrl)) {
    return handleRedisUnavailable(
      isProduction,
      throttlers,
      'REDIS_URL is required for distributed rate limiting in production.',
    );
  }

  if (!isValidRedisUrl(redisUrl)) {
    return handleRedisUnavailable(
      isProduction,
      throttlers,
      'REDIS_URL must be a valid redis:// or rediss:// URL for rate limiting.',
    );
  }

  const storage = createStorage(redisUrl, {
    fallback: resolveThrottlerFallback(
      configService.get('THROTTLER_REDIS_FALLBACK'),
      configService.get('THROTTLER_FAIL_OPEN'),
    ),
  });

  try {
    await withTimeout(
      storage.assertReady(),
      THROTTLER_READINESS_TIMEOUT_MS,
      `Redis throttler readiness check timed out after ${THROTTLER_READINESS_TIMEOUT_MS} ms`,
    );
    logger.log('Using Redis-backed distributed throttler storage');
    return {
      throttlers,
      storage,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (isProduction && bootOptional) {
      // REDIS_BOOT_OPTIONAL: keep the Redis storage. Its client keeps
      // reconnecting in the background, so distributed throttling resumes on
      // its own once Redis returns; until then the runtime degraded policy
      // (closed / memory / open) applies per request.
      logger.error(
        `Redis throttler connection failed: ${message}. REDIS_BOOT_OPTIONAL=true: starting anyway; the Redis client keeps reconnecting in the background.`,
      );
      return { throttlers, storage };
    }
    return handleRedisUnavailable(
      isProduction,
      throttlers,
      `Redis throttler connection failed: ${message}`,
    );
  }
}

function handleRedisUnavailable(
  isProduction: boolean,
  throttlers: ThrottlerOptions[],
  message: string,
): ThrottlerModuleOptions {
  if (isProduction) {
    throw new Error(message);
  }

  logger.warn(`${message} Falling back to in-memory throttler storage.`);
  return throttlers;
}

function isValidRedisUrl(redisUrl: string): boolean {
  try {
    const url = new URL(redisUrl);
    return url.protocol === 'redis:' || url.protocol === 'rediss:';
  } catch {
    return false;
  }
}
