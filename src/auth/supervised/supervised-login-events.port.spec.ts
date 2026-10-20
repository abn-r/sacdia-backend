import {
  fireEvent,
  NOOP_SUPERVISED_LOGIN_EVENTS,
  resolveSupervisedLoginEvents,
} from './supervised-login-events.port';

describe('supervised login events port', () => {
  it('the default binding does nothing for every event', async () => {
    for (const handler of Object.values(NOOP_SUPERVISED_LOGIN_EVENTS)) {
      await expect(
        Promise.resolve((handler as (input: unknown) => unknown)({})),
      ).resolves.toBeUndefined();
    }
  });

  it('merges a partial binding over the no-op default', () => {
    const onLoginLocked = jest.fn();
    const events = resolveSupervisedLoginEvents({ onLoginLocked });
    events.onLoginLocked({ identifier: 'x', retryAfterSeconds: 1 });
    expect(onLoginLocked).toHaveBeenCalledTimes(1);
    expect(() => events.onTeenSessionStarted({ userId: 'u' })).not.toThrow();
  });

  it('accepts a missing binding', () => {
    expect(resolveSupervisedLoginEvents(undefined)).toEqual(
      NOOP_SUPERVISED_LOGIN_EVENTS,
    );
    expect(resolveSupervisedLoginEvents(null)).toEqual(
      NOOP_SUPERVISED_LOGIN_EVENTS,
    );
  });

  describe('fireEvent', () => {
    it('swallows an async rejection and reports it', async () => {
      const onError = jest.fn();
      await expect(
        fireEvent(() => Promise.reject(new Error('push down')), onError),
      ).resolves.toBeUndefined();
      expect(onError).toHaveBeenCalledWith(expect.any(Error));
    });

    it('swallows a synchronous throw too', async () => {
      const onError = jest.fn();
      await expect(
        fireEvent(() => {
          throw new Error('sync');
        }, onError),
      ).resolves.toBeUndefined();
      expect(onError).toHaveBeenCalledTimes(1);
    });

    it('does not run the call on the caller stack (it is deferred)', async () => {
      const order: string[] = [];
      const pending = fireEvent(() => {
        order.push('event');
      });
      order.push('caller');
      await pending;
      expect(order).toEqual(['caller', 'event']);
    });

    it('works without an error handler', async () => {
      await expect(
        fireEvent(() => Promise.reject(new Error('x'))),
      ).resolves.toBeUndefined();
    });
  });
});
