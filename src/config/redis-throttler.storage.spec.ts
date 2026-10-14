const mockCreateClient = jest.fn();

jest.mock('redis', () => ({
  createClient: (...args: unknown[]) => mockCreateClient(...args),
}));

import { Logger } from '@nestjs/common';
import {
  RedisThrottlerStorage,
  THROTTLER_REDIS_CONNECT_TIMEOUT_MS,
  throttlerReconnectStrategy,
} from './redis-throttler.storage';

describe('RedisThrottlerStorage', () => {
  const client = {
    isOpen: false,
    isReady: false,
    connect: jest.fn(async () => {
      client.isOpen = true;
      client.isReady = true;
    }),
    disconnect: jest.fn(async () => {
      client.isOpen = false;
      client.isReady = false;
    }),
    ping: jest.fn().mockResolvedValue('PONG'),
    eval: jest.fn().mockResolvedValue([1, 500, 0, 0]),
    quit: jest.fn(),
    on: jest.fn(),
  };

  beforeEach(() => {
    client.isOpen = false;
    client.isReady = false;
    jest.clearAllMocks();
    mockCreateClient.mockReturnValue(client);
  });

  it('pins RESP2 and migration-compatible command and keepalive defaults', () => {
    new RedisThrottlerStorage('redis://localhost:6379');

    expect(mockCreateClient).toHaveBeenCalledWith({
      url: 'redis://localhost:6379',
      RESP: 2,
      socket: {
        keepAliveInitialDelay: 5000,
        connectTimeout: THROTTLER_REDIS_CONNECT_TIMEOUT_MS,
        reconnectStrategy: throttlerReconnectStrategy,
      },
      commandOptions: {
        timeout: undefined,
      },
    });
  });

  it('bounds the connect attempt so an unreachable host cannot hang forever', () => {
    new RedisThrottlerStorage('redis://localhost:6379');

    const options = mockCreateClient.mock.calls[0][0];
    expect(options.socket.connectTimeout).toBe(5_000);
  });

  describe('throttlerReconnectStrategy', () => {
    it('never gives up: always returns a delay, never an Error', () => {
      for (const retries of [0, 1, 5, 10, 100, 10_000]) {
        const delay = throttlerReconnectStrategy(retries);
        expect(typeof delay).toBe('number');
        expect(delay).toBeGreaterThan(0);
      }
    });

    it('backs off exponentially but stays capped (jitter < 100 ms)', () => {
      expect(throttlerReconnectStrategy(0)).toBeLessThan(200);
      expect(throttlerReconnectStrategy(1)).toBeGreaterThanOrEqual(200);
      expect(throttlerReconnectStrategy(50)).toBeLessThan(3_100);
      expect(throttlerReconnectStrategy(50)).toBeGreaterThanOrEqual(3_000);
    });
  });

  it('pings during explicit startup readiness checks', async () => {
    const storage = new RedisThrottlerStorage('redis://localhost:6379');

    await storage.assertReady();

    expect(client.connect).toHaveBeenCalledTimes(1);
    expect(client.ping).toHaveBeenCalledTimes(1);
  });

  it('does not ping on increment hot path when the client is already ready', async () => {
    client.isOpen = true;
    client.isReady = true;
    const storage = new RedisThrottlerStorage('redis://localhost:6379');

    await storage.increment('user:1', 1000, 3, 60000, 'short');

    expect(client.connect).not.toHaveBeenCalled();
    expect(client.ping).not.toHaveBeenCalled();
    expect(client.eval).toHaveBeenCalledTimes(1);
  });

  it('reconnects on increment when the client is open but not ready', async () => {
    client.isOpen = true;
    client.isReady = false;
    const storage = new RedisThrottlerStorage('redis://localhost:6379');

    await storage.increment('user:1', 1000, 3, 60000, 'short');

    expect(client.disconnect).toHaveBeenCalledTimes(1);
    expect(client.connect).toHaveBeenCalledTimes(1);
    expect(client.ping).not.toHaveBeenCalled();
    expect(client.eval).toHaveBeenCalledTimes(1);
  });
});

describe('RedisThrottlerStorage hot-path connect bound', () => {
  const client = {
    isOpen: false,
    isReady: false,
    connect: jest.fn(),
    disconnect: jest.fn(),
    ping: jest.fn(),
    eval: jest.fn(),
    quit: jest.fn(),
    on: jest.fn(),
  };

  beforeEach(() => {
    jest.useFakeTimers();
    jest.clearAllMocks();
    client.isOpen = false;
    client.isReady = false;
    mockCreateClient.mockReturnValue(client);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('fails the request instead of hanging when connect never resolves', async () => {
    client.connect.mockReturnValue(new Promise(() => undefined));
    const storage = new RedisThrottlerStorage('redis://localhost:6379', {
      connectWaitMs: 2_000,
    });

    const pending = storage.increment('ip:1', 1000, 3, 60000, 'short');
    const assertion = expect(pending).rejects.toThrow('connect timed out');
    await jest.advanceTimersByTimeAsync(2_000);

    await assertion;
    expect(client.eval).not.toHaveBeenCalled();
  });

  it('does not bound assertReady itself (its caller owns the readiness timeout)', async () => {
    let resolveConnect!: () => void;
    client.connect.mockReturnValue(
      new Promise<void>((resolve) => {
        resolveConnect = resolve;
      }),
    );
    client.ping.mockResolvedValue('PONG');
    const storage = new RedisThrottlerStorage('redis://localhost:6379', {
      connectWaitMs: 2_000,
    });

    const ready = storage.assertReady();
    await jest.advanceTimersByTimeAsync(60_000);
    resolveConnect();

    await expect(ready).resolves.toBeUndefined();
  });
});

describe('RedisThrottlerStorage fail-open', () => {
  const client = {
    isOpen: true,
    isReady: true,
    connect: jest.fn(),
    disconnect: jest.fn(),
    ping: jest.fn(),
    eval: jest.fn(),
    quit: jest.fn(),
    on: jest.fn(),
  };
  const quotaError = Object.assign(
    new Error('ERR max requests limit exceeded. Limit: 500000, Usage: 500002'),
    { name: 'ReplyError' },
  );
  let nowMs = 0;
  const now = () => nowMs;

  function createStorage(
    options: ConstructorParameters<typeof RedisThrottlerStorage>[1] = {},
  ) {
    return new RedisThrottlerStorage('redis://localhost:6379', {
      now,
      failOpen: true,
      failOpenCooldownMs: 15_000,
      ...options,
    });
  }

  beforeEach(() => {
    nowMs = 1_000_000;
    client.isOpen = true;
    client.isReady = true;
    jest.clearAllMocks();
    client.eval.mockResolvedValue([1, 500, 0, 0]);
    mockCreateClient.mockReturnValue(client);
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('lets the request through when Redis rejects the command (quota)', async () => {
    client.eval.mockRejectedValue(quotaError);
    const storage = createStorage();

    await expect(
      storage.increment('ip:1', 1000, 3, 60000, 'short'),
    ).resolves.toEqual({
      totalHits: 0,
      timeToExpire: 1,
      isBlocked: false,
      timeToBlockExpire: 0,
    });
  });

  it('lets the request through when the connection itself fails', async () => {
    client.isOpen = false;
    client.isReady = false;
    client.connect.mockRejectedValue(new Error('connect ECONNREFUSED'));
    const storage = createStorage();

    await expect(
      storage.increment('ip:1', 1000, 3, 60000, 'short'),
    ).resolves.toMatchObject({ isBlocked: false, totalHits: 0 });
  });

  it('skips Redis during the cooldown and logs the outage only once', async () => {
    client.eval.mockRejectedValue(quotaError);
    const storage = createStorage();

    await storage.increment('ip:1', 1000, 3, 60000, 'short');
    nowMs += 5_000;
    await storage.increment('ip:1', 1000, 3, 60000, 'medium');
    await storage.increment('ip:1', 1000, 3, 60000, 'long');

    expect(client.eval).toHaveBeenCalledTimes(1);
    expect(Logger.prototype.error).toHaveBeenCalledTimes(1);
    expect(Logger.prototype.error).toHaveBeenCalledWith(
      expect.stringContaining('rate limiting is DISABLED'),
    );
  });

  it('retries Redis after the cooldown and resumes enforcing limits', async () => {
    client.eval.mockRejectedValueOnce(quotaError);
    const storage = createStorage();

    await storage.increment('ip:1', 1000, 3, 60000, 'short');
    nowMs += 15_001;
    client.eval.mockResolvedValueOnce([4, 700, 1, 60000]);

    await expect(
      storage.increment('ip:1', 1000, 3, 60000, 'short'),
    ).resolves.toEqual({
      totalHits: 4,
      timeToExpire: 1,
      isBlocked: true,
      timeToBlockExpire: 60,
    });
    expect(client.eval).toHaveBeenCalledTimes(2);
    expect(Logger.prototype.log).toHaveBeenCalledWith(
      expect.stringContaining('recovered'),
    );
  });

  it('keeps the cooldown running if the retry fails again', async () => {
    client.eval.mockRejectedValue(quotaError);
    const storage = createStorage();

    await storage.increment('ip:1', 1000, 3, 60000, 'short');
    nowMs += 15_001;
    await storage.increment('ip:1', 1000, 3, 60000, 'short');
    nowMs += 1_000;
    await storage.increment('ip:1', 1000, 3, 60000, 'short');

    expect(client.eval).toHaveBeenCalledTimes(2);
  });

  it('does not fail open on a genuine over-limit answer from Redis', async () => {
    client.eval.mockResolvedValue([21, 8000, 1, 60000]);
    const storage = createStorage();

    await expect(
      storage.increment('ip:1', 10000, 20, 60000, 'medium'),
    ).resolves.toMatchObject({ isBlocked: true, totalHits: 21 });
  });

  it('fails closed by default', async () => {
    client.eval.mockRejectedValue(quotaError);
    const storage = new RedisThrottlerStorage('redis://localhost:6379', {
      now,
    });

    await expect(
      storage.increment('ip:1', 1000, 3, 60000, 'short'),
    ).rejects.toBe(quotaError);
  });

  it('rethrows Redis errors when failOpen is disabled', async () => {
    client.eval.mockRejectedValue(quotaError);
    const storage = createStorage({ failOpen: false });

    await expect(
      storage.increment('ip:1', 1000, 3, 60000, 'short'),
    ).rejects.toBe(quotaError);
    await expect(
      storage.increment('ip:1', 1000, 3, 60000, 'short'),
    ).rejects.toBe(quotaError);
    expect(client.eval).toHaveBeenCalledTimes(2);
  });

  it('dedupes the client error events instead of logging every reconnect', () => {
    createStorage();
    const [, onError] = client.on.mock.calls.find(
      ([event]) => event === 'error',
    )!;

    for (let i = 0; i < 100; i += 1) onError(quotaError);

    expect(Logger.prototype.error).toHaveBeenCalledTimes(1);
    expect(Logger.prototype.error).toHaveBeenCalledWith(
      expect.stringContaining('Redis throttler error'),
      expect.anything(),
    );
  });

  it('still fails the startup readiness check when Redis is down', async () => {
    client.isOpen = false;
    client.isReady = false;
    client.connect.mockRejectedValue(new Error('connect ECONNREFUSED'));
    const storage = createStorage();

    await expect(storage.assertReady()).rejects.toThrow('ECONNREFUSED');
  });
});

describe('RedisThrottlerStorage THROTTLER_REDIS_FALLBACK', () => {
  const client = {
    isOpen: true,
    isReady: true,
    connect: jest.fn(),
    disconnect: jest.fn(),
    ping: jest.fn(),
    eval: jest.fn(),
    quit: jest.fn(),
    on: jest.fn(),
  };
  const down = new Error('connect ECONNREFUSED');
  let nowMs = 0;
  const now = () => nowMs;

  function createStorage(
    options: ConstructorParameters<typeof RedisThrottlerStorage>[1] = {},
  ) {
    return new RedisThrottlerStorage('redis://localhost:6379', {
      now,
      failOpenCooldownMs: 15_000,
      ...options,
    });
  }

  beforeEach(() => {
    nowMs = 1_000_000;
    client.isOpen = true;
    client.isReady = true;
    jest.clearAllMocks();
    client.eval.mockResolvedValue([1, 500, 0, 0]);
    mockCreateClient.mockReturnValue(client);
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe("fallback: 'memory'", () => {
    it('enforces the limit in memory while Redis is down and blocks over-limit', async () => {
      client.eval.mockRejectedValue(down);
      const storage = createStorage({ fallback: 'memory' });
      const hit = () => storage.increment('ip:1', 1000, 3, 60000, 'short');

      const results = [await hit(), await hit(), await hit(), await hit()];

      expect(results.map((r) => r.totalHits)).toEqual([1, 2, 3, 4]);
      expect(results.map((r) => r.isBlocked)).toEqual([
        false,
        false,
        false,
        true,
      ]);
      expect(results[3].timeToBlockExpire).toBeGreaterThan(0);
      // Redis was tried once, then skipped for the cooldown.
      expect(client.eval).toHaveBeenCalledTimes(1);
    });

    it('keeps counters separate per key and per throttler tier', async () => {
      client.eval.mockRejectedValue(down);
      const storage = createStorage({ fallback: 'memory' });

      await storage.increment('ip:1', 1000, 1, 60000, 'short');
      const sameKeyOtherTier = await storage.increment(
        'ip:1',
        10000,
        20,
        60000,
        'medium',
      );
      const otherKey = await storage.increment('ip:2', 1000, 1, 60000, 'short');

      expect(sameKeyOtherTier).toMatchObject({
        totalHits: 1,
        isBlocked: false,
      });
      expect(otherKey).toMatchObject({ totalHits: 1, isBlocked: false });
    });

    it('logs the in-memory fallback once per outage', async () => {
      client.eval.mockRejectedValue(down);
      const storage = createStorage({ fallback: 'memory' });

      await storage.increment('ip:1', 1000, 3, 60000, 'short');
      await storage.increment('ip:1', 1000, 3, 60000, 'short');
      await storage.increment('ip:2', 1000, 3, 60000, 'short');

      expect(Logger.prototype.error).toHaveBeenCalledTimes(1);
      expect(Logger.prototype.error).toHaveBeenCalledWith(
        expect.stringContaining('in-memory rate limiting'),
      );
    });

    it('also covers connection failures, not just EVAL errors', async () => {
      client.isOpen = false;
      client.isReady = false;
      client.connect.mockRejectedValue(down);
      const storage = createStorage({ fallback: 'memory' });

      await expect(
        storage.increment('ip:1', 1000, 3, 60000, 'short'),
      ).resolves.toMatchObject({ totalHits: 1, isBlocked: false });
    });

    it('returns to Redis after the cooldown and logs recovery', async () => {
      client.eval.mockRejectedValueOnce(down);
      const storage = createStorage({ fallback: 'memory' });
      await storage.increment('ip:1', 1000, 3, 60000, 'short');
      nowMs += 15_001;
      client.eval.mockResolvedValueOnce([2, 700, 0, 0]);

      await expect(
        storage.increment('ip:1', 1000, 3, 60000, 'short'),
      ).resolves.toMatchObject({ totalHits: 2, isBlocked: false });

      expect(client.eval).toHaveBeenCalledTimes(2);
      expect(Logger.prototype.log).toHaveBeenCalledWith(
        expect.stringContaining('recovered'),
      );
    });

    it('keeps honouring a genuine 429 answer from Redis', async () => {
      client.eval.mockResolvedValue([21, 8000, 1, 60000]);
      const storage = createStorage({ fallback: 'memory' });

      await expect(
        storage.increment('ip:1', 10000, 20, 60000, 'medium'),
      ).resolves.toMatchObject({ isBlocked: true, totalHits: 21 });
    });

    it('releases the in-memory sweep timer on shutdown', async () => {
      client.eval.mockRejectedValue(down);
      client.isOpen = false;
      const storage = createStorage({ fallback: 'memory' });
      await storage.increment('ip:1', 1000, 3, 60000, 'short');

      await expect(storage.onApplicationShutdown()).resolves.toBeUndefined();
    });
  });

  describe("fallback: 'open'", () => {
    it('lets requests through unthrottled', async () => {
      client.eval.mockRejectedValue(down);
      const storage = createStorage({ fallback: 'open' });

      for (let i = 0; i < 10; i += 1) {
        await expect(
          storage.increment('ip:1', 1000, 3, 60000, 'short'),
        ).resolves.toMatchObject({ isBlocked: false, totalHits: 0 });
      }
    });

    it('is equivalent to the legacy failOpen: true option', async () => {
      client.eval.mockRejectedValue(down);
      const storage = createStorage({ failOpen: true });

      await expect(
        storage.increment('ip:1', 1000, 3, 60000, 'short'),
      ).resolves.toMatchObject({ isBlocked: false, totalHits: 0 });
      expect(Logger.prototype.error).toHaveBeenCalledWith(
        expect.stringContaining('rate limiting is DISABLED'),
      );
    });

    it('lets an explicit fallback win over the legacy failOpen flag', async () => {
      client.eval.mockRejectedValue(down);
      const storage = createStorage({ failOpen: true, fallback: 'closed' });

      await expect(
        storage.increment('ip:1', 1000, 3, 60000, 'short'),
      ).rejects.toBe(down);
    });
  });

  describe("fallback: 'closed' (default)", () => {
    it('rethrows Redis errors on every request and never uses memory', async () => {
      client.eval.mockRejectedValue(down);
      const storage = createStorage({ fallback: 'closed' });

      await expect(
        storage.increment('ip:1', 1000, 3, 60000, 'short'),
      ).rejects.toBe(down);
      await expect(
        storage.increment('ip:1', 1000, 3, 60000, 'short'),
      ).rejects.toBe(down);
      expect(client.eval).toHaveBeenCalledTimes(2);
    });

    it('is the default when no option is given', async () => {
      client.eval.mockRejectedValue(down);
      const storage = createStorage();

      await expect(
        storage.increment('ip:1', 1000, 3, 60000, 'short'),
      ).rejects.toBe(down);
    });
  });
});
