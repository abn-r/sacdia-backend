const mockCreateClient = jest.fn();

jest.mock('redis', () => ({
  createClient: (...args: unknown[]) => mockCreateClient(...args),
}));

import { Logger } from '@nestjs/common';
import { RedisThrottlerStorage } from './redis-throttler.storage';

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
      },
      commandOptions: {
        timeout: undefined,
      },
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
