import {
  DEVICE_PAIRING_FAILURE_WINDOW_MS,
  DevicePairingFailureCounter,
} from './device-pairing-failure-counter';

describe('DevicePairingFailureCounter (memory cache)', () => {
  let counter: DevicePairingFailureCounter;

  beforeEach(() => {
    jest.useFakeTimers({ now: new Date('2026-10-20T12:00:00.000Z') });
    // A plain cache-manager double: no Redis store, so the in-process Map is used.
    counter = new DevicePairingFailureCounter({} as never);
  });

  afterEach(() => jest.useRealTimers());

  it('counts failures per IP, starting at zero', async () => {
    expect(await counter.current('1.1.1.1')).toBe(0);
    expect(await counter.increment('1.1.1.1')).toBe(1);
    expect(await counter.increment('1.1.1.1')).toBe(2);
    expect(await counter.current('1.1.1.1')).toBe(2);
    expect(await counter.current('2.2.2.2')).toBe(0);
  });

  it('parallel failures are all counted (no lost update)', async () => {
    await Promise.all(
      Array.from({ length: 50 }, () => counter.increment('1.1.1.1')),
    );
    expect(await counter.current('1.1.1.1')).toBe(50);
  });

  it('the window is a day from the FIRST failure and later failures do not extend it', async () => {
    await counter.increment('1.1.1.1');
    jest.advanceTimersByTime(DEVICE_PAIRING_FAILURE_WINDOW_MS - 1000);
    await counter.increment('1.1.1.1');
    expect(await counter.current('1.1.1.1')).toBe(2);

    jest.advanceTimersByTime(2000);

    expect(await counter.current('1.1.1.1')).toBe(0);
    expect(await counter.increment('1.1.1.1')).toBe(1);
  });

  it('uses the Redis client behind the cache store when there is one (atomic EVAL)', async () => {
    const client = {
      eval: jest.fn().mockResolvedValue(7),
      get: jest.fn().mockResolvedValue('7'),
    };
    const redisBacked = new DevicePairingFailureCounter({
      stores: [{ store: { getClient: () => Promise.resolve(client) } }],
    } as never);

    expect(await redisBacked.increment('9.9.9.9')).toBe(7);
    expect(await redisBacked.current('9.9.9.9')).toBe(7);
    expect(client.eval).toHaveBeenCalledWith(expect.stringContaining('INCR'), {
      keys: ['device-pairing:failures:v1:9.9.9.9'],
      arguments: [String(DEVICE_PAIRING_FAILURE_WINDOW_MS)],
    });
  });
});
