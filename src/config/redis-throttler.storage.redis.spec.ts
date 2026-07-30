import { randomBytes } from 'node:crypto';
import { resolveRedisIntegrationUrl } from './redis-integration-test.config';
import {
  createRedisThrottlerClient,
  RedisThrottlerStorage,
} from './redis-throttler.storage';

const redisUrl = resolveRedisIntegrationUrl(process.env);
const redisIt = redisUrl ? it : it.skip;
type RedisThrottlerClient = ReturnType<typeof createRedisThrottlerClient>;

function redisUrlWithCredentials(
  value: string,
  username: string,
  password: string,
): string {
  const parsed = new URL(value);
  parsed.username = username;
  parsed.password = password;
  return parsed.toString();
}

async function clientIdsForUser(
  client: RedisThrottlerClient,
  username: string,
): Promise<string[]> {
  const response = await client.sendCommand(['CLIENT', 'LIST']);
  if (typeof response !== 'string') {
    throw new Error('Redis CLIENT LIST returned a non-string response');
  }

  return response
    .split('\n')
    .filter((line) => line.includes(`user=${username}`))
    .map((line) => line.match(/(?:^| )id=(\d+)(?: |$)/)?.[1])
    .filter((id): id is string => id !== undefined);
}

async function waitForReplacementConnection(
  client: RedisThrottlerClient,
  username: string,
  previousId: string,
  timeoutMs = 3_000,
): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const replacement = (await clientIdsForUser(client, username)).find(
      (id) => id !== previousId,
    );
    if (replacement) return replacement;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(
    `Redis user ${username} did not reconnect within ${timeoutMs}ms`,
  );
}

describe('RedisThrottlerStorage real Redis contract', () => {
  let admin: RedisThrottlerClient | undefined;
  let storage: RedisThrottlerStorage | undefined;
  let key: string;
  let usersToDelete: Set<string>;

  beforeEach(() => {
    key = `redis-v6-compat:${process.pid}:${randomBytes(4).toString('hex')}`;
    usersToDelete = new Set();
  });

  afterEach(async () => {
    if (!redisUrl) return;
    const cleanupErrors: unknown[] = [];
    const shutdown = await Promise.allSettled([
      storage?.onApplicationShutdown(),
    ]);
    cleanupErrors.push(
      ...shutdown
        .filter(
          (result): result is PromiseRejectedResult =>
            result.status === 'rejected',
        )
        .map((result) => result.reason),
    );

    const cleanupClient = admin ?? createRedisThrottlerClient(redisUrl);
    try {
      if (!cleanupClient.isOpen) {
        await cleanupClient.connect();
      }
      const cleanup = await Promise.allSettled([
        cleanupClient.del([
          `throttler:integration:${key}:hits`,
          `throttler:integration:${key}:blocked`,
        ]),
        ...[...usersToDelete].map((username) =>
          cleanupClient.sendCommand(['ACL', 'DELUSER', username]),
        ),
      ]);
      cleanupErrors.push(
        ...cleanup
          .filter(
            (result): result is PromiseRejectedResult =>
              result.status === 'rejected',
          )
          .map((result) => result.reason),
      );
    } catch (error) {
      cleanupErrors.push(error);
    } finally {
      if (cleanupClient.isOpen) {
        await cleanupClient.quit().catch((error) => cleanupErrors.push(error));
      }
      storage = undefined;
      admin = undefined;
    }

    if (cleanupErrors.length > 0) {
      throw new AggregateError(
        cleanupErrors,
        'Redis integration cleanup failed',
      );
    }
  });

  redisIt(
    'connects, pings and executes the throttling Lua script atomically',
    async () => {
      if (!redisUrl) throw new Error('Redis integration URL required');
      storage = new RedisThrottlerStorage(redisUrl);

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
      admin = createRedisThrottlerClient(redisUrl);
      await admin.connect();
      const username = `reconnect-${process.pid}-${randomBytes(4).toString('hex')}`;
      const password = randomBytes(16).toString('hex');
      usersToDelete.add(username);
      await admin.sendCommand([
        'ACL',
        'SETUSER',
        username,
        'reset',
        'on',
        `>${password}`,
        '~*',
        '+@all',
      ]);
      storage = new RedisThrottlerStorage(
        redisUrlWithCredentials(redisUrl, username, password),
      );
      await storage.assertReady();
      const [previousId] = await clientIdsForUser(admin, username);
      if (!previousId) {
        throw new Error(`Redis user ${username} has no active connection`);
      }

      const killed = await admin.sendCommand([
        'CLIENT',
        'KILL',
        'USER',
        username,
        'SKIPME',
        'yes',
      ]);
      const replacementId = await waitForReplacementConnection(
        admin,
        username,
        previousId,
      );
      const result = await storage.increment(
        key,
        10_000,
        3,
        10_000,
        'integration',
      );

      expect(Number(killed)).toBeGreaterThan(0);
      expect(replacementId).not.toBe(previousId);
      expect(result).toMatchObject({ totalHits: 1, isBlocked: false });
    },
  );

  redisIt(
    'rejects instead of bypassing throttling when Redis denies EVAL',
    async () => {
      if (!redisUrl) throw new Error('Redis integration URL required');
      admin = createRedisThrottlerClient(redisUrl);
      await admin.connect();
      const restrictedUser = `throttler-${process.pid}-${randomBytes(4).toString('hex')}`;
      const password = randomBytes(16).toString('hex');
      usersToDelete.add(restrictedUser);
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
      storage = new RedisThrottlerStorage(
        redisUrlWithCredentials(redisUrl, restrictedUser, password),
      );
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
