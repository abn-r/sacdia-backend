import { Test } from '@nestjs/testing';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { DistributedLockService } from './distributed-lock.service';

/**
 * Just enough of node-redis for the lock: SET NX PX and the compare-and-delete
 * EVAL. Single-threaded JS makes each command atomic, like Redis.
 */
class FakeRedis {
  readonly data = new Map<string, string>();
  failNext = false;

  set(key: string, value: string, options: { NX: true; PX: number }) {
    if (this.failNext) {
      this.failNext = false;
      return Promise.reject(new Error('redis down'));
    }
    expect(options).toEqual({ NX: true, PX: expect.any(Number) });
    if (this.data.has(key)) {
      return Promise.resolve(null);
    }
    this.data.set(key, value);
    return Promise.resolve('OK');
  }

  eval(script: string, options: { keys: string[]; arguments: string[] }) {
    expect(script).toContain("redis.call('get', KEYS[1]) == ARGV[1]");
    const [key] = options.keys;
    if (this.data.get(key) === options.arguments[0]) {
      this.data.delete(key);
      return Promise.resolve(1);
    }
    return Promise.resolve(0);
  }

  /** Simulates the PX TTL elapsing. */
  expire(key: string) {
    this.data.delete(key);
  }
}

async function build(cache: object): Promise<DistributedLockService> {
  const moduleRef = await Test.createTestingModule({
    providers: [
      DistributedLockService,
      { provide: CACHE_MANAGER, useValue: cache },
    ],
  }).compile();
  return moduleRef.get(DistributedLockService);
}

describe('DistributedLockService owned locks', () => {
  describe('with Redis behind the cache', () => {
    let redis: FakeRedis;
    let service: DistributedLockService;

    beforeEach(async () => {
      redis = new FakeRedis();
      service = await build({
        stores: [{ store: { getClient: () => Promise.resolve(redis) } }],
      });
    });

    it('lets exactly one of two concurrent acquirers win', async () => {
      const results = await Promise.all([
        service.tryAcquireOwned('cron-manual:job', 1000),
        service.tryAcquireOwned('cron-manual:job', 1000),
      ]);

      expect(results.filter((lock) => lock !== null)).toHaveLength(1);
      expect(redis.data.size).toBe(1);
      const winner = results.find((lock) => lock !== null)!;
      expect(winner.backend).toBe('redis');
      expect(redis.data.get('lock:cron-manual:job')).toBe(winner.token);
    });

    it('can be acquired again after the owner releases it', async () => {
      const first = await service.tryAcquireOwned('k', 1000);
      await service.releaseOwned(first!);

      expect(await service.tryAcquireOwned('k', 1000)).not.toBeNull();
    });

    it('does not release a lock another holder took after the TTL expired', async () => {
      const runA = await service.tryAcquireOwned('k', 1000);
      redis.expire('lock:k'); // run A outlived its TTL
      const runB = await service.tryAcquireOwned('k', 1000);
      expect(runB).not.toBeNull();

      await service.releaseOwned(runA!); // A's finally

      expect(redis.data.get('lock:k')).toBe(runB!.token);
      expect(await service.tryAcquireOwned('k', 1000)).toBeNull();
    });

    it('fails open (logged) when Redis errors on acquire, and releasing that handle is a no-op', async () => {
      redis.failNext = true;

      const lock = await service.tryAcquireOwned('k', 1000);

      expect(lock).toMatchObject({ key: 'k', backend: 'none' });
      await expect(service.releaseOwned(lock!)).resolves.toBeUndefined();
    });

    it('swallows a Redis error on release', async () => {
      const lock = await service.tryAcquireOwned('k', 1000);
      redis.eval = jest.fn().mockRejectedValue(new Error('redis down'));

      await expect(service.releaseOwned(lock!)).resolves.toBeUndefined();
    });
  });

  describe('without Redis (in-memory cache, local dev)', () => {
    let service: DistributedLockService;

    beforeEach(async () => {
      // cache-manager's default store is a Keyv over a plain Map: no getClient.
      service = await build({ stores: [{ store: new Map() }] });
    });

    it('lets exactly one of two concurrent acquirers win', async () => {
      const results = await Promise.all([
        service.tryAcquireOwned('k', 1000),
        service.tryAcquireOwned('k', 1000),
      ]);

      expect(results.filter((lock) => lock !== null)).toHaveLength(1);
      expect(results.find((lock) => lock !== null)!.backend).toBe('memory');
    });

    it('only the owner releases; an expired lock can be taken over', async () => {
      jest.useFakeTimers({ now: 1_000_000 });
      try {
        const runA = await service.tryAcquireOwned('k', 1000);
        expect(await service.tryAcquireOwned('k', 1000)).toBeNull();

        jest.setSystemTime(1_002_000); // TTL elapsed
        const runB = await service.tryAcquireOwned('k', 1000);
        expect(runB).not.toBeNull();

        await service.releaseOwned(runA!);
        expect(await service.tryAcquireOwned('k', 1000)).toBeNull();

        await service.releaseOwned(runB!);
        expect(await service.tryAcquireOwned('k', 1000)).not.toBeNull();
      } finally {
        jest.useRealTimers();
      }
    });
  });

  it('treats a cache without stores as no-Redis', async () => {
    const service = await build({});

    expect(await service.tryAcquireOwned('k', 1000)).toMatchObject({
      backend: 'memory',
    });
  });
});
