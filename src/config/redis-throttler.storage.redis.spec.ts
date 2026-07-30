import { randomBytes } from 'node:crypto';
import { createClient, type RedisClientType } from 'redis';
import { RedisThrottlerStorage } from './redis-throttler.storage';

const redisUrl = process.env.REDIS_INTEGRATION_URL;
const redisIt =
  process.env.ALLOW_REDIS_INTEGRATION === '1' && redisUrl ? it : it.skip;

function requireLocalRedisUrl(value: string): string {
  const parsed = new URL(value);
  if (!['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname)) {
    throw new Error('Redis integration tests require a loopback URL');
  }
  return value;
}

describe('RedisThrottlerStorage real Redis contract', () => {
  let admin: RedisClientType | undefined;
  let storage: RedisThrottlerStorage | undefined;
  let key: string;
  let restrictedUser: string | undefined;

  beforeEach(() => {
    key = `redis-v6-compat:${process.pid}:${randomBytes(4).toString('hex')}`;
  });

  afterEach(async () => {
    await storage?.onApplicationShutdown().catch(() => undefined);
    if (admin?.isOpen) {
      await admin.del(
        `throttler:integration:${key}:hits`,
        `throttler:integration:${key}:blocked`,
      );
      if (restrictedUser) {
        await admin.sendCommand(['ACL', 'DELUSER', restrictedUser]);
      }
      await admin.quit();
    }
    storage = undefined;
    admin = undefined;
    restrictedUser = undefined;
  });

  redisIt(
    'connects, pings and executes the throttling Lua script atomically',
    async () => {
      if (!redisUrl) throw new Error('Redis integration URL required');
      storage = new RedisThrottlerStorage(requireLocalRedisUrl(redisUrl));

      await storage.assertReady();
      const first = await storage.increment(
        key,
        10_000,
        1,
        10_000,
        'integration',
      );
      const blocked = await storage.increment(
        key,
        10_000,
        1,
        10_000,
        'integration',
      );

      expect(first).toMatchObject({ totalHits: 1, isBlocked: false });
      expect(blocked).toMatchObject({ totalHits: 2, isBlocked: true });
      expect(blocked.timeToBlockExpire).toBeGreaterThan(0);
    },
  );

  redisIt(
    'reconnects after Redis kills the active throttler connection',
    async () => {
      if (!redisUrl) throw new Error('Redis integration URL required');
      const localRedisUrl = requireLocalRedisUrl(redisUrl);
      storage = new RedisThrottlerStorage(localRedisUrl);
      admin = createClient({ url: localRedisUrl, RESP: 2 });
      await admin.connect();
      await storage.assertReady();

      const killed = await admin.sendCommand([
        'CLIENT',
        'KILL',
        'TYPE',
        'normal',
        'SKIPME',
        'yes',
      ]);
      await new Promise((resolve) => setTimeout(resolve, 500));
      const result = await storage.increment(
        key,
        10_000,
        3,
        10_000,
        'integration',
      );

      expect(Number(killed)).toBeGreaterThan(0);
      expect(result).toMatchObject({ totalHits: 1, isBlocked: false });
    },
  );

  redisIt(
    'rejects instead of bypassing throttling when Redis denies EVAL',
    async () => {
      if (!redisUrl) throw new Error('Redis integration URL required');
      const localRedisUrl = requireLocalRedisUrl(redisUrl);
      admin = createClient({ url: localRedisUrl, RESP: 2 });
      await admin.connect();
      restrictedUser = `throttler-${process.pid}-${randomBytes(4).toString('hex')}`;
      const password = randomBytes(16).toString('hex');
      await admin.sendCommand([
        'ACL',
        'SETUSER',
        restrictedUser,
        'reset',
        'on',
        `>${password}`,
        '~*',
        '-@all',
        '+ping',
        '+client',
        '+quit',
      ]);
      const restrictedUrl = new URL(localRedisUrl);
      restrictedUrl.username = restrictedUser;
      restrictedUrl.password = password;
      storage = new RedisThrottlerStorage(restrictedUrl.toString());
      await storage.assertReady();

      await expect(
        storage.increment(key, 10_000, 3, 10_000, 'integration'),
      ).rejects.toThrow(/NOPERM|permission/i);
      await expect(
        admin.exists(
          `throttler:integration:${key}:hits`,
          `throttler:integration:${key}:blocked`,
        ),
      ).resolves.toBe(0);
    },
  );
});
