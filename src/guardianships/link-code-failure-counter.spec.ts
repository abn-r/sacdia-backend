import { LinkCodeFailureCounter } from './link-code-failure-counter';
import { LINK_CODE_FAILURE_WINDOW_MS } from './guardianships.constants';

const USER = '55555555-5555-4555-8555-555555555555';
const OTHER = '99999999-9999-4999-8999-999999999999';
const T0 = 1_800_000_000_000;

/**
 * Stand-in for the node-redis client: `eval` is one indivisible step (like the
 * real server), and it yields to the event loop first so parallel callers
 * interleave exactly where a read-modify-write would lose updates.
 */
function fakeRedis() {
  const values = new Map<string, number>();
  const expiries = new Map<string, number>();
  const client = {
    eval: jest.fn(
      async (
        script: string,
        options: { keys: string[]; arguments: string[] },
      ) => {
        await Promise.resolve();
        const key = options.keys[0];
        const count = (values.get(key) ?? 0) + 1;
        values.set(key, count);
        if (count === 1) {
          expiries.set(key, Number(options.arguments[0]));
        }
        return count;
      },
    ),
    get: jest.fn(async (key: string) => {
      const value = values.get(key);
      return value === undefined ? null : String(value);
    }),
  };
  const cache = {
    get: jest.fn(),
    set: jest.fn(),
    stores: [{ store: { getClient: jest.fn(async () => client) } }],
  };
  return { client, cache, values, expiries };
}

describe('LinkCodeFailureCounter (redis store)', () => {
  it('counts 25 parallel failures as exactly 25, each caller seeing a distinct total', async () => {
    const { cache, client } = fakeRedis();
    const counter = new LinkCodeFailureCounter(cache as any);

    const totals = await Promise.all(
      Array.from({ length: 25 }, () => counter.increment(USER)),
    );

    expect([...totals].sort((a, b) => a - b)).toEqual(
      Array.from({ length: 25 }, (_, index) => index + 1),
    );
    expect(await counter.current(USER)).toBe(25);
    // One EVAL per failure: no read-modify-write through the cache API.
    expect(client.eval).toHaveBeenCalledTimes(25);
    expect(cache.get).not.toHaveBeenCalled();
    expect(cache.set).not.toHaveBeenCalled();
  });

  it('arms the 24h window on the first failure and keys it per user', async () => {
    const { cache, client, expiries } = fakeRedis();
    const counter = new LinkCodeFailureCounter(cache as any);

    await counter.increment(USER);
    await counter.increment(USER);
    await counter.increment(OTHER);

    expect(client.eval.mock.calls[0][1]).toEqual({
      keys: [`linkcode:failures:v2:${USER}`],
      arguments: [String(LINK_CODE_FAILURE_WINDOW_MS)],
    });
    expect(expiries.get(`linkcode:failures:v2:${USER}`)).toBe(
      LINK_CODE_FAILURE_WINDOW_MS,
    );
    expect(await counter.current(USER)).toBe(2);
    expect(await counter.current(OTHER)).toBe(1);
  });

  it('reads 0 for a user without failures', async () => {
    const { cache } = fakeRedis();
    expect(await new LinkCodeFailureCounter(cache as any).current(USER)).toBe(
      0,
    );
  });

  it('lets a Redis error through for the caller to handle', async () => {
    const { cache, client } = fakeRedis();
    client.eval.mockRejectedValue(new Error('redis down'));
    await expect(
      new LinkCodeFailureCounter(cache as any).increment(USER),
    ).rejects.toThrow('redis down');
  });
});

describe('LinkCodeFailureCounter (memory cache)', () => {
  let nowSpy: jest.SpyInstance;
  beforeEach(() => {
    nowSpy = jest.spyOn(Date, 'now').mockReturnValue(T0);
  });
  afterEach(() => nowSpy.mockRestore());

  it('counts parallel failures exactly', async () => {
    const counter = new LinkCodeFailureCounter({ stores: [] } as any);
    await Promise.all(
      Array.from({ length: 25 }, () => counter.increment(USER)),
    );
    expect(await counter.current(USER)).toBe(25);
  });

  it('anchors the window at the first failure and restarts after it', async () => {
    const counter = new LinkCodeFailureCounter({} as any);
    await counter.increment(USER);
    nowSpy.mockReturnValue(T0 + LINK_CODE_FAILURE_WINDOW_MS - 1);
    expect(await counter.increment(USER)).toBe(2);

    nowSpy.mockReturnValue(T0 + LINK_CODE_FAILURE_WINDOW_MS);
    expect(await counter.current(USER)).toBe(0);
    expect(await counter.increment(USER)).toBe(1);
  });
});
