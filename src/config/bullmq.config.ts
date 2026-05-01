import { BullModule } from '@nestjs/bullmq';
import { ConnectionOptions } from 'bullmq';

/**
 * Parse a Redis URL string into ioredis-compatible ConnectionOptions.
 * BullMQ internally uses ioredis — it does NOT accept a `url` shorthand like
 * the plain `redis` package does; we must decompose the URL.
 */
export function parseRedisConnectionOptions(
  redisUrl: string,
): ConnectionOptions {
  const url = new URL(redisUrl);

  const options: ConnectionOptions = {
    host: url.hostname || 'localhost',
    port: url.port ? parseInt(url.port, 10) : 6379,
    // ioredis expects the password without a username in most setups
    password: url.password ? decodeURIComponent(url.password) : undefined,
    username:
      url.username && url.username !== 'default'
        ? decodeURIComponent(url.username)
        : undefined,
    // Extract db index from the pathname (e.g. "/1")
    db:
      url.pathname && url.pathname.length > 1
        ? parseInt(url.pathname.slice(1), 10)
        : 0,
    // Enable TLS for rediss:// URLs (Upstash, Redis Cloud, etc.)
    tls: url.protocol === 'rediss:' ? {} : undefined,
    // BullMQ workers run long-lived connections — avoid aggressive reconnect spam
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
    lazyConnect: false,
  };

  return options;
}

export function isPlaceholderUrl(value: string): boolean {
  return ['YOUR_PASSWORD', 'YOUR_REGION', 'YOUR_PORT'].some((token) =>
    value.includes(token),
  );
}

/**
 * Returns a BullModule.forRoot() configuration that reads REDIS_URL from the
 * environment. If REDIS_URL is not set or contains placeholder values, returns
 * an empty array so the app starts without any queue connection.
 *
 * IMPORTANT: This function must be called AFTER dotenv has populated
 * process.env. In main.ts, `import 'dotenv/config'` must be the first import
 * so that all subsequent @Module decorator evaluations (which run at file-load
 * time, before NestJS DI initialization) see the correct env vars.
 *
 * Usage in AppModule:
 *   imports: [..., ...buildBullRootConfig()]
 */
export function buildBullRootConfig() {
  const rawUrl = process.env.REDIS_URL?.trim();

  if (!rawUrl || isPlaceholderUrl(rawUrl)) {
    return [];
  }

  try {
    new URL(rawUrl); // validate URL shape before handing to ioredis
    const connection = parseRedisConnectionOptions(rawUrl);

    return [
      BullModule.forRoot({
        connection,
      }),
    ];
  } catch {
    console.warn('BullMQ: REDIS_URL is not a valid URL — queue disabled.');
    return [];
  }
}
