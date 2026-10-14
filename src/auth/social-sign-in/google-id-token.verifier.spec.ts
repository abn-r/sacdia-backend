import { createRemoteJWKSet, customFetch } from 'jose';
import {
  AppServiceUnavailableException,
  AppUnauthorizedException,
} from '../../common/errors/app.exception';
import { ErrorCode } from '../../common/errors/error-codes';
import { GoogleIdTokenVerifier } from './google-id-token.verifier';
import {
  FUTURE,
  PAST,
  createIdTokenFixture,
  type IdTokenFixture,
} from '../../../test/helpers/id-token-fixtures';

describe('GoogleIdTokenVerifier', () => {
  let fixture: IdTokenFixture;
  let verifier: GoogleIdTokenVerifier;
  const audience = 'web-client-id.apps.googleusercontent.com';
  const nonce = 'raw-nonce-123';

  const validClaims = () => ({
    iss: 'https://accounts.google.com',
    aud: audience,
    sub: '1234567890',
    exp: FUTURE,
    nonce,
    email: 'ana@example.com',
    email_verified: true,
    given_name: 'Ana',
    family_name: 'Pérez',
    picture: 'https://lh3.googleusercontent.com/a/photo',
  });

  beforeAll(async () => {
    fixture = await createIdTokenFixture();
  });

  beforeEach(() => {
    verifier = new GoogleIdTokenVerifier({
      audiences: [audience, 'ios-client-id.apps.googleusercontent.com'],
      getKey: fixture.getKey,
    });
  });

  it('returns the identity for a valid token', async () => {
    const token = await fixture.sign(validClaims());
    await expect(verifier.verify(token, nonce)).resolves.toEqual({
      provider: 'google',
      sub: '1234567890',
      email: 'ana@example.com',
      emailVerified: true,
      givenName: 'Ana',
      familyName: 'Pérez',
      picture: 'https://lh3.googleusercontent.com/a/photo',
    });
  });

  it('accepts the legacy issuer without scheme', async () => {
    const token = await fixture.sign({
      ...validClaims(),
      iss: 'accounts.google.com',
    });
    await expect(verifier.verify(token, nonce)).resolves.toMatchObject({
      sub: '1234567890',
    });
  });

  it('reports an unverified email instead of rejecting', async () => {
    const token = await fixture.sign({
      ...validClaims(),
      email_verified: false,
    });
    await expect(verifier.verify(token, nonce)).resolves.toMatchObject({
      emailVerified: false,
    });
  });

  const rejects = async (token: string, usedNonce = nonce) => {
    const error = await verifier
      .verify(token, usedNonce)
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AppUnauthorizedException);
    expect((error as AppUnauthorizedException).code).toBe(
      ErrorCode.AUTH_INVALID_TOKEN,
    );
  };

  it('rejects a token signed by an unknown key', async () => {
    await rejects(await fixture.signWithUnknownKey(validClaims()));
  });

  it('rejects a wrong issuer', async () => {
    await rejects(
      await fixture.sign({ ...validClaims(), iss: 'https://evil.example' }),
    );
  });

  it('rejects an audience outside GOOGLE_OAUTH_AUDIENCES', async () => {
    await rejects(
      await fixture.sign({ ...validClaims(), aud: 'other-client' }),
    );
  });

  it('rejects an expired token', async () => {
    await rejects(await fixture.sign({ ...validClaims(), exp: PAST }));
  });

  it('rejects a nonce mismatch', async () => {
    await rejects(await fixture.sign(validClaims()), 'different-nonce');
  });

  it('rejects a token without nonce', async () => {
    const { nonce: _omit, ...claims } = validClaims();
    await rejects(await fixture.sign(claims));
  });

  it('reports a JWKS endpoint answering 500 as 503, not as an invalid token', async () => {
    verifier = new GoogleIdTokenVerifier({
      audiences: [audience],
      getKey: createRemoteJWKSet(new URL('https://jwks.test/certs'), {
        [customFetch]: async () => new Response('oops', { status: 500 }),
      }),
    });
    const token = await fixture.sign(validClaims());
    const error = await verifier.verify(token, nonce).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AppServiceUnavailableException);
    expect((error as AppServiceUnavailableException).code).toBe(
      ErrorCode.AUTH_OAUTH_PROVIDER_UNAVAILABLE,
    );
  });

  it('rejects everything when no audience is configured', async () => {
    verifier = new GoogleIdTokenVerifier({
      audiences: [],
      getKey: fixture.getKey,
    });
    await rejects(await fixture.sign(validClaims()));
  });
});
