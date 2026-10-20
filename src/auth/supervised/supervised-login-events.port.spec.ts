import { GuardianSecurityNotificationsService } from '../../guardianships/guardian-security-notifications.service';
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

  it('keeps the prototype methods of a CLASS INSTANCE binding (the real Nest provider), bound to it', async () => {
    // Regression (QA BUG-1): object spread does not copy prototype methods, so a
    // class instance bound through `useExisting` was silently replaced by no-ops.
    const notifications = {
      sendToUser: jest.fn().mockResolvedValue({ success: true }),
    };
    const prisma: any = {
      users: {
        findUnique: jest.fn().mockResolvedValue({
          name: 'Ana',
          birthday: new Date(Date.now() - 15 * 365.25 * 24 * 3600 * 1000),
          country_id: null,
          guardianships_as_dependent: [{ guardian_user_id: 'g-1' }],
        }),
      },
    };
    const cache = {
      get: jest.fn().mockResolvedValue(undefined),
      set: jest.fn().mockResolvedValue(undefined),
    };
    const agePolicy = {
      getPolicy: jest.fn().mockResolvedValue({
        minSelfLoginAge: 13,
        ageOfMajority: 18,
        timeZone: 'America/Mexico_City',
      }),
    };
    const real = new GuardianSecurityNotificationsService(
      prisma,
      notifications as any,
      agePolicy as any,
      cache as any,
    );

    const events = resolveSupervisedLoginEvents(real);
    await events.onTeenSessionStarted({ userId: 'teen-1' });
    await events.onGuardianLinked({
      teenUserId: 'teen-1',
      guardianUserId: 'g-1',
    });

    expect(notifications.sendToUser).toHaveBeenCalledTimes(2);
    expect(notifications.sendToUser.mock.calls.map((c) => c[0].userId)).toEqual(
      ['g-1', 'teen-1'],
    );
  });

  it('binds every method of a class instance to the instance (this survives detaching)', () => {
    class Adapter {
      readonly seen: string[] = [];
      onTeenSessionStarted(input: { userId: string }): void {
        this.seen.push(input.userId);
      }
    }
    const adapter = new Adapter();
    const { onTeenSessionStarted } = resolveSupervisedLoginEvents(adapter);
    onTeenSessionStarted({ userId: 'u-1' });
    expect(adapter.seen).toEqual(['u-1']);
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
