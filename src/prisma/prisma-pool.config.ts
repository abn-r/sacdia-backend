import { ConfigService } from '@nestjs/config';
import type { PoolConfig } from 'pg';

const DEFAULT_POOL_MAX = 20;
const DEFAULT_POOL_IDLE_TIMEOUT_MS = 30_000;
const DEFAULT_POOL_CONNECTION_TIMEOUT_MS = 15_000;
const DEFAULT_POOL_KEEP_ALIVE_INITIAL_DELAY_MS = 10_000;
const DEFAULT_DATABASE_APPLICATION_NAME = 'sacdia-backend';

export function buildPrismaPoolConfig(
  configService: ConfigService,
): PoolConfig {
  const connectionString = configService.get<string>('DATABASE_URL');
  if (!connectionString) {
    throw new Error('DATABASE_URL is required to configure the Prisma pool.');
  }

  return {
    connectionString,
    max: configService.get<number>('PRISMA_POOL_MAX', DEFAULT_POOL_MAX),
    idleTimeoutMillis: configService.get<number>(
      'PRISMA_POOL_IDLE_TIMEOUT_MS',
      DEFAULT_POOL_IDLE_TIMEOUT_MS,
    ),
    connectionTimeoutMillis: configService.get<number>(
      'PRISMA_POOL_CONNECTION_TIMEOUT_MS',
      DEFAULT_POOL_CONNECTION_TIMEOUT_MS,
    ),
    keepAlive: true,
    keepAliveInitialDelayMillis: configService.get<number>(
      'PRISMA_POOL_KEEP_ALIVE_INITIAL_DELAY_MS',
      DEFAULT_POOL_KEEP_ALIVE_INITIAL_DELAY_MS,
    ),
    application_name: configService.get<string>(
      'DATABASE_APPLICATION_NAME',
      DEFAULT_DATABASE_APPLICATION_NAME,
    ),
  };
}
