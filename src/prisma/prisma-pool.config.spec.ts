import { ConfigService } from '@nestjs/config';
import { buildPrismaPoolConfig } from './prisma-pool.config';

function createConfig(values: Record<string, unknown>): ConfigService {
  return {
    get: jest.fn((key: string, defaultValue?: unknown) =>
      Object.prototype.hasOwnProperty.call(values, key)
        ? values[key]
        : defaultValue,
    ),
  } as unknown as ConfigService;
}

describe('buildPrismaPoolConfig', () => {
  it('uses production-safe defaults while preserving the current pool capacity', () => {
    const config = createConfig({
      DATABASE_URL: 'postgresql://user:pass@localhost:5432/sacdia',
    });

    expect(buildPrismaPoolConfig(config)).toEqual({
      connectionString: 'postgresql://user:pass@localhost:5432/sacdia',
      max: 20,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 15_000,
      keepAlive: true,
      keepAliveInitialDelayMillis: 10_000,
      application_name: 'sacdia-backend',
    });
  });

  it('uses explicitly configured pool limits and connection metadata', () => {
    const config = createConfig({
      DATABASE_URL: 'postgresql://user:pass@localhost:5432/sacdia',
      PRISMA_POOL_MAX: 8,
      PRISMA_POOL_IDLE_TIMEOUT_MS: 45_000,
      PRISMA_POOL_CONNECTION_TIMEOUT_MS: 7_000,
      PRISMA_POOL_KEEP_ALIVE_INITIAL_DELAY_MS: 12_000,
      DATABASE_APPLICATION_NAME: 'sacdia-worker',
    });

    expect(buildPrismaPoolConfig(config)).toMatchObject({
      max: 8,
      idleTimeoutMillis: 45_000,
      connectionTimeoutMillis: 7_000,
      keepAliveInitialDelayMillis: 12_000,
      application_name: 'sacdia-worker',
    });
  });
});
