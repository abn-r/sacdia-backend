import 'reflect-metadata';
import { ACTING_SCOPE_KEY } from '../auth/acting-for/acting-scope.decorator';
import { ReleaseController } from './release.controller';
import { AdultClaimController } from './adult-claim.controller';
import { IS_PUBLIC_KEY } from '../common/decorators/public.decorator';

const THROTTLE_LIMIT = 'THROTTLER:LIMIT';

describe('ReleaseController', () => {
  it('POST users/me/release/email: release:email scope, 5/hour on every tier', () => {
    const handler = ReleaseController.prototype.setEmail;
    expect(Reflect.getMetadata(ACTING_SCOPE_KEY, handler)).toBe(
      'release:email',
    );
    for (const tier of ['short', 'medium', 'long']) {
      expect(Reflect.getMetadata(`${THROTTLE_LIMIT}${tier}`, handler)).toBe(5);
    }
  });

  it('delegates with the token subject and wraps the envelope', async () => {
    const release = {
      setEmail: jest.fn().mockResolvedValue({ completed: true, thawed: false }),
    };
    const controller = new ReleaseController(release as any);
    await expect(
      controller.setEmail({ sub: 'u-1' } as any, { email: 'a@b.co' }),
    ).resolves.toEqual({
      status: 'success',
      data: { completed: true, thawed: false },
    });
    expect(release.setEmail).toHaveBeenCalledWith('u-1', 'a@b.co');
  });
});

describe('AdultClaimController', () => {
  it('POST auth/adult-claim/redeem is public and throttled 10/hour on every tier', () => {
    const handler = AdultClaimController.prototype.redeem;
    expect(Reflect.getMetadata(IS_PUBLIC_KEY, handler)).toBe(true);
    // Never carries an acting scope: nobody acts for a person without a login.
    expect(Reflect.getMetadata(ACTING_SCOPE_KEY, handler)).toBeUndefined();
    for (const tier of ['short', 'medium', 'long']) {
      expect(Reflect.getMetadata(`${THROTTLE_LIMIT}${tier}`, handler)).toBe(10);
    }
  });

  it('passes the resolved client IP to the service', async () => {
    const claims = {
      redeem: jest.fn().mockResolvedValue({ status: 'success' }),
    };
    const controller = new AdultClaimController(claims as any);
    const dto = { code: 'X' } as any;
    await controller.redeem(dto, { ip: '203.0.113.9', headers: {} });
    expect(claims.redeem).toHaveBeenCalledWith(dto, expect.any(String));
  });
});
