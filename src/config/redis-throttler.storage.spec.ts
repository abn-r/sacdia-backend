const mockCreateClient = jest.fn();

jest.mock('redis', () => ({
  createClient: (...args: unknown[]) => mockCreateClient(...args),
}));

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
