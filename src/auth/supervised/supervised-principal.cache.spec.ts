import { ActingForCache } from '../acting-for/acting-for.cache';
import {
  msUntilNextLocalMidnight,
  SUPERVISED_ACTIVE_TTL_MS,
  SUPERVISED_ADULT_TTL_MS,
  SUPERVISED_BLOCKED_TTL_MS,
  SupervisedPrincipalCache,
} from './supervised-principal.cache';

function fakeCacheManager() {
  const store = new Map<string, unknown>();
  return {
    store,
    get: jest.fn(async (key: string) => store.get(key)),
    set: jest.fn(async (key: string, value: unknown) => {
      store.set(key, value);
    }),
  };
}

describe('msUntilNextLocalMidnight', () => {
  it('counts the time left in the local calendar day', () => {
    // 2026-10-20T06:30:00Z is 00:30 in Mexico City (UTC-6, no DST since 2022).
    const now = new Date('2026-10-20T06:30:00.000Z');
    expect(msUntilNextLocalMidnight('America/Mexico_City', now)).toBe(
      23.5 * 3_600_000,
    );
  });

  it('uses the zone, not the server clock', () => {
    // 23:59:00 in Mexico City is already the next UTC day.
    const now = new Date('2026-10-21T05:59:00.000Z');
    expect(msUntilNextLocalMidnight('America/Mexico_City', now)).toBe(60_000);
  });

  it('falls back to a full day for an unknown zone', () => {
    expect(msUntilNextLocalMidnight('Not/AZone')).toBe(86_400_000);
  });
});

describe('SupervisedPrincipalCache', () => {
  const build = () => {
    const manager = fakeCacheManager();
    const epochs = new ActingForCache(manager as any);
    return {
      manager,
      cache: new SupervisedPrincipalCache(manager as any, epochs),
      epochs,
    };
  };

  it('stores the state under supv:v3:{user}:{epoch} with the adult TTL', async () => {
    const { manager, cache } = build();
    await cache.setState('u1', 5, { state: 'adult' }, null);
    expect(manager.set).toHaveBeenCalledWith(
      'supv:v3:u1:5',
      { state: 'adult' },
      SUPERVISED_ADULT_TTL_MS,
    );
    expect(await cache.getState('u1', 5)).toEqual({ state: 'adult' });
    // Another epoch is a miss.
    expect(await cache.getState('u1', 6)).toBeNull();
  });

  it('uses 60s for supervised and 10s for blocked', async () => {
    const { manager, cache } = build();
    await cache.setState(
      'u1',
      1,
      { state: 'supervised', supervision: 'active' },
      null,
    );
    await cache.setState(
      'u1',
      2,
      { state: 'blocked', cause: 'login_disabled' },
      null,
    );
    expect(manager.set).toHaveBeenNthCalledWith(
      1,
      'supv:v3:u1:1',
      expect.anything(),
      SUPERVISED_ACTIVE_TTL_MS,
    );
    expect(manager.set).toHaveBeenNthCalledWith(
      2,
      'supv:v3:u1:2',
      expect.anything(),
      SUPERVISED_BLOCKED_TTL_MS,
    );
  });

  it('caches the restricted unknown-age state for 60s (it moves on a bump anyway)', async () => {
    const { manager, cache } = build();
    await cache.setState('u1', 1, { state: 'profile_incomplete' }, null);
    expect(manager.set).toHaveBeenCalledWith(
      'supv:v3:u1:1',
      { state: 'profile_incomplete' },
      SUPERVISED_ACTIVE_TTL_MS,
    );
  });

  it('the state key is v3: entries cached by older code (v1 pre-restriction, v2 without the login method) are never read', async () => {
    const { manager, cache } = build();
    manager.store.set('supv:v1:u1:1', { state: 'adult' });
    // A v2 entry has no login_method: read after the deploy it would let a
    // handle session through while FAMILY_TEEN_LOGIN_ENABLED is off.
    manager.store.set('supv:v2:u1:1', {
      state: 'supervised',
      supervision: 'active',
    });
    expect(await cache.getState('u1', 1)).toBeNull();
  });

  it('caps the TTL at the next local midnight (age transition without waiting for the TTL)', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-10-21T05:59:30.000Z'));
    try {
      const { manager, cache } = build();
      await cache.setState('u1', 1, { state: 'adult' }, 'America/Mexico_City');
      // 30s left before 00:00 in Mexico City; the 1h adult TTL is capped.
      expect(manager.set).toHaveBeenCalledWith(
        'supv:v3:u1:1',
        { state: 'adult' },
        30_000,
      );
    } finally {
      jest.useRealTimers();
    }
  });

  it('shares the acting epoch key', async () => {
    const { manager, epochs, cache } = build();
    const epoch = await epochs.initEpoch('u1');
    expect(await cache.getEpoch('u1')).toBe(epoch);
    expect(manager.store.has('acting:epoch:u1')).toBe(true);
  });

  it('stores session liveness under the epoch', async () => {
    const { cache } = build();
    await cache.setSession('u1', 3, 'sid-1', true);
    expect(await cache.getSession('u1', 3, 'sid-1')).toBe(true);
    expect(await cache.getSession('u1', 4, 'sid-1')).toBeNull();
    expect(await cache.getSession('u1', 3, 'sid-2')).toBeNull();
  });
});
