import { envValidationSchema } from './env.validation';

describe('infrastructure environment validation', () => {
  it('applies bounded positive defaults for PostgreSQL pool settings', () => {
    expect(
      envValidationSchema.extract('PRISMA_POOL_MAX').validate(undefined),
    ).toMatchObject({ value: 20 });
    expect(
      envValidationSchema
        .extract('PRISMA_POOL_IDLE_TIMEOUT_MS')
        .validate(undefined),
    ).toMatchObject({ value: 30_000 });
    expect(
      envValidationSchema.extract('PRISMA_POOL_MAX').validate(0).error,
    ).toBeDefined();
    expect(
      envValidationSchema.extract('PRISMA_POOL_MAX').validate(101).error,
    ).toBeDefined();
  });

  it('validates cache TTL and Redis connection timeout as positive integers', () => {
    expect(
      envValidationSchema.extract('CACHE_DEFAULT_TTL_MS').validate(undefined),
    ).toMatchObject({ value: 86_400_000 });
    expect(
      envValidationSchema
        .extract('CACHE_REDIS_CONNECTION_TIMEOUT_MS')
        .validate(undefined),
    ).toMatchObject({ value: 5_000 });
    expect(
      envValidationSchema.extract('CACHE_DEFAULT_TTL_MS').validate(-1).error,
    ).toBeDefined();
  });

  it('only accepts Redis-compatible URL schemes', () => {
    const redisUrl = envValidationSchema.extract('REDIS_URL');

    expect(
      redisUrl.validate('rediss://default:secret@cache.example.com').error,
    ).toBeUndefined();
    expect(redisUrl.validate('https://cache.example.com').error).toBeDefined();
  });
});
