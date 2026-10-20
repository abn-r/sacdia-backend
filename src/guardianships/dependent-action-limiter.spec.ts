import { Logger } from '@nestjs/common';
import { ErrorCode } from '../common/errors/error-codes';
import { DependentActionLimiter } from './dependent-action-limiter';

const HOUR = 3_600_000;

function fakeCache() {
  const store = new Map<string, unknown>();
  return {
    store,
    get: jest.fn(async (key: string) => store.get(key)),
    set: jest.fn(async (key: string, value: unknown) => {
      store.set(key, value);
    }),
  };
}

describe('DependentActionLimiter', () => {
  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(new Date('2026-10-20T12:00:00.000Z'));
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  });
  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('allows the limit and answers 429 on the next hit, with the wait', async () => {
    const limiter = new DependentActionLimiter(fakeCache() as any);
    for (let i = 0; i < 5; i += 1) {
      await limiter.consume(
        'reset:dep-1',
        5,
        HOUR,
        ErrorCode.AUTH_LOGIN_LOCKED,
      );
    }
    await expect(
      limiter.consume('reset:dep-1', 5, HOUR, ErrorCode.AUTH_LOGIN_LOCKED),
    ).rejects.toMatchObject({
      status: 429,
      code: ErrorCode.AUTH_LOGIN_LOCKED,
    });
  });

  it('carries retry_after_seconds in namedArgs (the filter turns it into Retry-After)', async () => {
    const limiter = new DependentActionLimiter(fakeCache() as any);
    await limiter.consume('k', 1, HOUR, ErrorCode.AUTH_LOGIN_LOCKED);
    jest.advanceTimersByTime(10 * 60_000);
    try {
      await limiter.consume('k', 1, HOUR, ErrorCode.AUTH_LOGIN_LOCKED);
      throw new Error('expected 429');
    } catch (error) {
      expect((error as any).getResponse().namedArgs).toEqual({
        retry_after_seconds: 3000,
      });
    }
  });

  it('keeps one counter per key (per dependent)', async () => {
    const limiter = new DependentActionLimiter(fakeCache() as any);
    for (let i = 0; i < 5; i += 1)
      await limiter.consume('reset:dep-1', 5, HOUR);
    await expect(
      limiter.consume('reset:dep-2', 5, HOUR),
    ).resolves.toBeUndefined();
  });

  it('opens a new window once the first one expires', async () => {
    const limiter = new DependentActionLimiter(fakeCache() as any);
    for (let i = 0; i < 5; i += 1) await limiter.consume('k', 5, HOUR);
    jest.advanceTimersByTime(HOUR + 1);
    await expect(limiter.consume('k', 5, HOUR)).resolves.toBeUndefined();
  });

  it('is shared through the cache (a second instance sees the first one hits)', async () => {
    const cache = fakeCache() as any;
    const a = new DependentActionLimiter(cache);
    const b = new DependentActionLimiter(cache);
    for (let i = 0; i < 3; i += 1) await a.consume('k', 3, HOUR);
    await expect(b.consume('k', 3, HOUR)).rejects.toMatchObject({
      status: 429,
    });
  });

  it('never fails open when the cache is down: it falls back to the process', async () => {
    const cache = fakeCache();
    cache.get.mockRejectedValue(new Error('redis down'));
    cache.set.mockRejectedValue(new Error('redis down'));
    const limiter = new DependentActionLimiter(cache as any);
    for (let i = 0; i < 5; i += 1) await limiter.consume('k', 5, HOUR);
    await expect(limiter.consume('k', 5, HOUR)).rejects.toMatchObject({
      status: 429,
    });
  });

  it('without a domain code it is the plain throttler 429', async () => {
    const limiter = new DependentActionLimiter(fakeCache() as any);
    await limiter.consume('k', 1, HOUR);
    await expect(limiter.consume('k', 1, HOUR)).rejects.toMatchObject({
      status: 429,
    });
  });
});
