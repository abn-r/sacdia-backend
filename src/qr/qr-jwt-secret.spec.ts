import { resolveQrJwtSecret } from './qr-jwt-secret';

describe('resolveQrJwtSecret', () => {
  const access = 'a-secure-test-secret-that-is-32-chars';
  const qr = 'a-distinct-qr-secret-that-is-32ch';

  const config = (env: Record<string, string | undefined>) => ({
    get: (key: string) => env[key],
  });

  it('returns QR_JWT_SECRET when it is long enough and distinct', () => {
    expect(
      resolveQrJwtSecret(
        config({
          QR_JWT_SECRET: qr,
          BETTER_AUTH_SECRET: access,
        }),
      ),
    ).toBe(qr);
  });

  it('rejects a missing or short QR_JWT_SECRET', () => {
    expect(() =>
      resolveQrJwtSecret(
        config({
          QR_JWT_SECRET: 'too-short',
          BETTER_AUTH_SECRET: access,
        }),
      ),
    ).toThrow('QR_JWT_SECRET must be at least 32 characters');
  });

  it('rejects a QR secret that matches BETTER_AUTH_SECRET', () => {
    expect(() =>
      resolveQrJwtSecret(
        config({
          QR_JWT_SECRET: access,
          BETTER_AUTH_SECRET: access,
        }),
      ),
    ).toThrow('QR_JWT_SECRET must be distinct from BETTER_AUTH_SECRET');
  });
});
