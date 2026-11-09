import { Logger } from '@nestjs/common';
import { MfaFailureCounter } from './mfa-failure-counter';
import { LoginFailureCounter } from '../../auth/login-failure-counter';

const memoryCache = () => ({ stores: [] }) as never;

describe('MfaFailureCounter', () => {
  afterEach(() => jest.restoreAllMocks());

  it('uses its own key namespace, separate from login', () => {
    const keys = (c: object) =>
      (c as any).keys('id', 'abc') as { failures: string };
    expect(keys(new MfaFailureCounter(memoryCache())).failures).toBe(
      'mfa:fail:id:abc',
    );
    expect(keys(new LoginFailureCounter(memoryCache())).failures).toBe(
      'login:fail:id:abc',
    );
  });

  it('is bound to the no-op events port, so a lock never notifies guardians', async () => {
    const counter = new MfaFailureCounter(memoryCache());
    const events = (counter as any).events;
    expect(
      events.onLoginLocked({ identifier: 'x', retryAfterSeconds: 1 }),
    ).toBeUndefined();

    // A real adapter on the LOGIN counter is called; the MFA counter has none.
    const onLoginLocked = jest.fn();
    const login = new LoginFailureCounter(memoryCache(), { onLoginLocked });
    for (let i = 0; i < 5; i += 1) {
      await counter.recordFailure('user-1');
      await login.recordFailure('user-1');
    }
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(onLoginLocked).toHaveBeenCalledTimes(1);
  });

  it('Redis down: the in-process fallback still limits the MFA prefix', async () => {
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const broken = {
      stores: [
        {
          store: {
            getClient: async () => ({
              eval: async () => {
                throw new Error('redis down');
              },
            }),
          },
        },
      ],
    } as never;
    const counter = new MfaFailureCounter(broken);
    for (let i = 0; i < 5; i += 1) await counter.recordFailure('user-1');
    expect((await counter.check('user-1')).locked).toBe(true);
    expect((await counter.check('user-2')).locked).toBe(false);
  });

  it('a login lock on the same string does not lock MFA (and vice versa)', async () => {
    const cache = memoryCache();
    const login = new LoginFailureCounter(cache);
    const mfa = new MfaFailureCounter(cache);
    for (let i = 0; i < 5; i += 1) await login.recordFailure('user-1');
    expect((await login.check('user-1')).locked).toBe(true);
    expect((await mfa.check('user-1')).locked).toBe(false);
  });
});
