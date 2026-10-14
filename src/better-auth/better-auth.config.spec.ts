import { betterAuth } from 'better-auth';
import { createBetterAuth } from './better-auth.config';

/**
 * Better Auth 1.7 validates the Prisma schema before every adapter call and
 * rejects the request on mismatch. Our tables keep SACDIA column names
 * (users.user_id, users.email_verified) and TOTP does not use the twoFactor
 * tables, so with the check on every OAuth request fails with
 * "Prisma schema mismatch".
 *
 * `better-auth` is mapped to a Jest mock (ESM-only package), so this asserts
 * the option reaches the factory rather than exercising the real check.
 */
describe('createBetterAuth', () => {
  it('disables Better Auth runtime schema validation', () => {
    createBetterAuth({} as never);

    expect(betterAuth).toHaveBeenCalledWith(
      expect.objectContaining({
        advanced: expect.objectContaining({
          database: expect.objectContaining({ validateSchema: false }),
        }),
      }),
    );
  });
});
