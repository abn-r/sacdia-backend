import { Logger } from '@nestjs/common';
import {
  CLEAR_SCRIPT,
  LOCK_TTL_SCRIPT,
  LOGIN_FALLBACK_IP_MAX_FAILURES,
  LOGIN_IP_MAX_FAILURES,
  LOGIN_LOCK_BASE_MS,
  LOGIN_LOCK_MAX_MS,
  LoginFailureCounter,
  RECORD_FAILURE_SCRIPT,
} from './login-failure-counter';
import type { SupervisedLoginEvents } from './supervised/supervised-login-events.port';

const MIN = 60_000;
const flush = () => new Promise<void>((resolve) => setImmediate(resolve));

/** A cache manager with NO redis store: the in-process path. */
const memoryCache = () => ({ stores: [] }) as never;

/**
 * A fake Redis that implements the three Lua scripts in JS. It proves the
 * wiring (keys, arguments, results) and the expected semantics of the scripts.
 */
class FakeRedis {
  private data = new Map<string, { value: number; expiresAt: number }>();
  failEval = false;
  evalCalls = 0;

  private live(key: string) {
    const entry = this.data.get(key);
    if (entry && entry.expiresAt > 0 && entry.expiresAt <= Date.now()) {
      this.data.delete(key);
      return undefined;
    }
    return entry;
  }

  ttl(key: string): number {
    const entry = this.live(key);
    if (!entry) return -2;
    return entry.expiresAt === 0 ? -1 : entry.expiresAt - Date.now();
  }

  async eval(
    script: string,
    options: { keys: string[]; arguments: string[] },
  ): Promise<unknown> {
    this.evalCalls += 1;
    if (this.failEval) throw new Error('redis down');
    const { keys, arguments: args } = options;
    if (script === RECORD_FAILURE_SCRIPT) {
      const [windowMs, max, base, cap, episodeTtl] = args.map(Number);
      const failures = this.live(keys[0]);
      const count = (failures?.value ?? 0) + 1;
      this.data.set(keys[0], {
        value: count,
        expiresAt:
          count === 1 || this.ttl(keys[0]) < 0
            ? Date.now() + windowMs
            : (failures?.expiresAt ?? Date.now() + windowMs),
      });
      if (count >= max) {
        const episode = (this.live(keys[2])?.value ?? 0) + 1;
        const lockMs = Math.min(base * 2 ** (episode - 1), cap);
        this.data.set(keys[2], {
          value: episode,
          expiresAt: Date.now() + lockMs + episodeTtl,
        });
        this.data.set(keys[1], { value: 1, expiresAt: Date.now() + lockMs });
        this.data.delete(keys[0]);
        return [count, lockMs, episode];
      }
      return [count, 0, 0];
    }
    if (script === LOCK_TTL_SCRIPT) {
      return Math.max(0, ...keys.map((key) => this.ttl(key)));
    }
    if (script === CLEAR_SCRIPT) {
      keys.forEach((key) => this.data.delete(key));
      return 1;
    }
    throw new Error('unknown script');
  }
}

const redisCache = (redis: FakeRedis) =>
  ({
    stores: [{ store: { getClient: async () => redis } }],
  }) as never;

describe.each([
  [
    'in-process',
    () => ({ cache: memoryCache(), redis: null as FakeRedis | null }),
  ],
  [
    'redis',
    () => {
      const redis = new FakeRedis();
      return { cache: redisCache(redis), redis };
    },
  ],
])('LoginFailureCounter (%s)', (_name, build) => {
  let counter: LoginFailureCounter;
  let events: { onLoginLocked: jest.Mock };
  let redis: FakeRedis | null;

  beforeEach(() => {
    jest
      .useFakeTimers({ doNotFake: ['setImmediate', 'nextTick'] })
      .setSystemTime(new Date('2026-10-20T12:00:00.000Z'));
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const built = build();
    redis = built.redis;
    events = { onLoginLocked: jest.fn() };
    counter = new LoginFailureCounter(
      built.cache,
      events as SupervisedLoginEvents,
    );
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  const fail = async (identifier: string, times: number, ip = '1.1.1.1') => {
    let last = { lockStarted: false, retryAfterSeconds: 0 };
    for (let i = 0; i < times; i += 1) {
      last = await counter.recordFailure(identifier, ip);
    }
    return last;
  };

  it('is not locked before any failure', async () => {
    expect(await counter.check('ana-7kq4m9tx', '1.1.1.1')).toEqual({
      locked: false,
    });
  });

  it('locks on the 5th failure of an identifier for 15 minutes (6th attempt = 429 semantics)', async () => {
    expect((await fail('ana-7kq4m9tx', 4)).lockStarted).toBe(false);
    expect(await counter.check('ana-7kq4m9tx', '9.9.9.9')).toEqual({
      locked: false,
    });

    const fifth = await counter.recordFailure('ana-7kq4m9tx', '1.1.1.1');
    expect(fifth).toEqual({ lockStarted: true, retryAfterSeconds: 900 });

    expect(await counter.check('ana-7kq4m9tx', '9.9.9.9')).toEqual({
      locked: true,
      retryAfterSeconds: 900,
    });
  });

  it('treats an unknown identifier exactly like a known one (same lock, same retry)', async () => {
    await fail('does-not-exist-1', 5);
    await fail('real-teen-77', 5);

    expect(await counter.check('does-not-exist-1', '2.2.2.2')).toEqual(
      await counter.check('real-teen-77', '2.2.2.2'),
    );
  });

  it('shares the counter between letter cases and surrounding spaces', async () => {
    await fail('Ana-7KQ4M9TX', 3);
    await fail('  ana-7kq4m9tx ', 2);

    expect((await counter.check('ANA-7kq4m9tx', '3.3.3.3')).locked).toBe(true);
  });

  it('keeps refusing during the lock and the lock does not reset by itself or extend', async () => {
    await fail('ana-7kq4m9tx', 5);
    jest.advanceTimersByTime(5 * MIN);

    const state = await counter.check('ana-7kq4m9tx', '3.3.3.3');
    expect(state).toEqual({ locked: true, retryAfterSeconds: 600 });
  });

  it('expires after 15 minutes and a success then resets everything', async () => {
    await fail('ana-7kq4m9tx', 5);
    jest.advanceTimersByTime(15 * MIN + 1_000);

    expect(await counter.check('ana-7kq4m9tx', '3.3.3.3')).toEqual({
      locked: false,
    });
    await counter.recordSuccess('ana-7kq4m9tx');
    // The counter really restarted: 4 more failures do not lock.
    expect((await fail('ana-7kq4m9tx', 4)).lockStarted).toBe(false);
  });

  it('doubles the lock on each repeat episode, capped at 24 hours', async () => {
    const durations: number[] = [];
    for (let episode = 1; episode <= 9; episode += 1) {
      const outcome = await fail('ana-7kq4m9tx', 5, `10.0.0.${episode}`);
      durations.push(outcome.retryAfterSeconds * 1000);
      jest.advanceTimersByTime(outcome.retryAfterSeconds * 1000 + 1_000);
    }
    expect(durations).toEqual([
      LOGIN_LOCK_BASE_MS,
      LOGIN_LOCK_BASE_MS * 2,
      LOGIN_LOCK_BASE_MS * 4,
      LOGIN_LOCK_BASE_MS * 8,
      LOGIN_LOCK_BASE_MS * 16,
      LOGIN_LOCK_BASE_MS * 32,
      LOGIN_LOCK_BASE_MS * 64,
      LOGIN_LOCK_MAX_MS,
      LOGIN_LOCK_MAX_MS,
    ]);
  });

  it('forgets the episode history after 24 hours of calm following the lock', async () => {
    await fail('ana-7kq4m9tx', 5);
    jest.advanceTimersByTime(LOGIN_LOCK_BASE_MS + 1_000);
    await fail('ana-7kq4m9tx', 5, '4.4.4.4'); // second episode: 30 min
    // 30 min lock + 24 h calm have to pass before the history is forgotten.
    jest.advanceTimersByTime(LOGIN_LOCK_MAX_MS + 2 * 60 * MIN);

    const outcome = await fail('ana-7kq4m9tx', 5, '5.5.5.5');
    expect(outcome.retryAfterSeconds * 1000).toBe(LOGIN_LOCK_BASE_MS);
  });

  it('opens the failure window at the FIRST failure and does not extend it', async () => {
    await fail('ana-7kq4m9tx', 1);
    jest.advanceTimersByTime(14 * MIN);
    await fail('ana-7kq4m9tx', 3, '6.6.6.6'); // 4 failures, still in the window
    jest.advanceTimersByTime(2 * MIN); // the window expired: counter resets
    expect((await fail('ana-7kq4m9tx', 1, '7.7.7.7')).lockStarted).toBe(false);
    expect((await counter.check('ana-7kq4m9tx', '7.7.7.7')).locked).toBe(false);
  });

  it('limits a client IP after 30 failures spread over many identifiers (15 min flat)', async () => {
    const ipMax = redis
      ? LOGIN_IP_MAX_FAILURES
      : LOGIN_FALLBACK_IP_MAX_FAILURES;
    let outcome = { lockStarted: false, retryAfterSeconds: 0 };
    for (let i = 0; i < ipMax; i += 1) {
      outcome = await counter.recordFailure(`spray-${i}`, '8.8.8.8');
    }
    expect(outcome).toEqual({ lockStarted: true, retryAfterSeconds: 900 });
    // Any identifier from that IP is refused, a fresh IP is not.
    expect((await counter.check('someone-new', '8.8.8.8')).locked).toBe(true);
    expect((await counter.check('someone-new', '9.9.9.9')).locked).toBe(false);
  });

  it('emits the lock-episode event once per episode, never on a failure counted under a lock', async () => {
    await fail('Ana-7KQ4M9TX', 5);
    await flush();
    expect(events.onLoginLocked).toHaveBeenCalledTimes(1);
    expect(events.onLoginLocked).toHaveBeenCalledWith({
      identifier: 'ana-7kq4m9tx',
      retryAfterSeconds: 900,
    });

    await flush();
    expect(events.onLoginLocked).toHaveBeenCalledTimes(1);
  });

  it('never fails the login when the event listener throws', async () => {
    events.onLoginLocked.mockRejectedValue(new Error('push down'));
    await expect(fail('ana-7kq4m9tx', 5)).resolves.toMatchObject({
      lockStarted: true,
    });
    await flush();
  });

  it('works without any event listener bound (no-op default)', async () => {
    const built = build();
    const bare = new LoginFailureCounter(built.cache);
    for (let i = 0; i < 5; i += 1) {
      await bare.recordFailure('ana-7kq4m9tx', '1.1.1.1');
    }
    expect((await bare.check('ana-7kq4m9tx', '1.1.1.1')).locked).toBe(true);
  });

  it('hashes the identifier: no raw identifier or handle ends up in a key', async () => {
    if (!redis) return;
    await fail('ana-7kq4m9tx', 1);
    const spy = jest.spyOn(redis, 'eval');
    await counter.check('ana-7kq4m9tx', '1.1.1.1');
    for (const call of spy.mock.calls) {
      expect(JSON.stringify(call[1].keys)).not.toContain('ana-7kq4m9tx');
    }
  });
});

describe('LoginFailureCounter with Redis errors', () => {
  it('falls back to the in-process limit, logs a warning and never fails open', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-10-20T12:00:00.000Z'));
    const warn = jest
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => undefined);
    const redis = new FakeRedis();
    redis.failEval = true;
    const counter = new LoginFailureCounter(redisCache(redis));

    for (let i = 0; i < 5; i += 1) {
      await counter.recordFailure('ana-7kq4m9tx', '1.1.1.1');
    }
    expect(await counter.check('ana-7kq4m9tx', '1.1.1.1')).toMatchObject({
      locked: true,
    });
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('login_lockout_redis_unavailable'),
    );
    // Rate-limited warning: one per window, not one per failure.
    expect(warn.mock.calls.length).toBeLessThanOrEqual(2);
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('a client that cannot even be obtained also degrades to the in-process limit', async () => {
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const broken = {
      stores: [
        {
          store: {
            getClient: async () => {
              throw new Error('no connection');
            },
          },
        },
      ],
    } as never;
    const counter = new LoginFailureCounter(broken);

    for (let i = 0; i < 5; i += 1) {
      await counter.recordFailure('ana-7kq4m9tx', '1.1.1.1');
    }
    expect((await counter.check('ana-7kq4m9tx', '1.1.1.1')).locked).toBe(true);
    jest.restoreAllMocks();
  });
});
