import { createHash } from 'crypto';
import { AppUnauthorizedException } from '../../common/errors/app.exception';
import { ErrorCode } from '../../common/errors/error-codes';
import { AppleIdTokenVerifier } from './apple-id-token.verifier';
import {
  FUTURE,
  PAST,
  createIdTokenFixture,
  type IdTokenFixture,
} from '../../../test/helpers/id-token-fixtures';

describe('AppleIdTokenVerifier', () => {
  let fixture: IdTokenFixture;
  let verifier: AppleIdTokenVerifier;
  const bundleId = 'app.sacdia.mobile';
  const nonce = 'raw-nonce-456';
  const hashedNonce = createHash('sha256').update(nonce).digest('hex');

  const validClaims = () => ({
    iss: 'https://appleid.apple.com',
    aud: bundleId,
    sub: '001234.abcdef.5678',
    exp: FUTURE,
    nonce: hashedNonce,
    nonce_supported: true,
    email: 'relay@privaterelay.appleid.com',
    email_verified: 'true',
    is_private_email: 'true',
  });

  beforeAll(async () => {
    fixture = await createIdTokenFixture();
  });

  beforeEach(() => {
    verifier = new AppleIdTokenVerifier({ bundleId, getKey: fixture.getKey });
  });

  it('returns the identity and parses the string email_verified', async () => {
    const token = await fixture.sign(validClaims());
    await expect(verifier.verify(token, nonce)).resolves.toEqual({
      provider: 'apple',
      sub: '001234.abcdef.5678',
      email: 'relay@privaterelay.appleid.com',
      emailVerified: true,
    });
  });

  it('accepts a boolean email_verified', async () => {
    const token = await fixture.sign({
      ...validClaims(),
      email_verified: true,
    });
    await expect(verifier.verify(token, nonce)).resolves.toMatchObject({
      emailVerified: true,
    });
  });

  it('reports email_verified "false" as unverified', async () => {
    const token = await fixture.sign({
      ...validClaims(),
      email_verified: 'false',
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

  it('rejects a raw (unhashed) nonce claim', async () => {
    await rejects(await fixture.sign({ ...validClaims(), nonce }));
  });

  it('rejects a nonce mismatch', async () => {
    await rejects(await fixture.sign(validClaims()), 'other-nonce');
  });

  it('rejects a wrong audience', async () => {
    await rejects(await fixture.sign({ ...validClaims(), aud: 'app.other' }));
  });

  it('rejects a wrong issuer', async () => {
    await rejects(
      await fixture.sign({
        ...validClaims(),
        iss: 'https://accounts.google.com',
      }),
    );
  });

  it('rejects an expired token', async () => {
    await rejects(await fixture.sign({ ...validClaims(), exp: PAST }));
  });

  it('rejects an unknown signing key', async () => {
    await rejects(await fixture.signWithUnknownKey(validClaims()));
  });

  it('rejects everything when APPLE_BUNDLE_ID is empty', async () => {
    verifier = new AppleIdTokenVerifier({
      bundleId: '',
      getKey: fixture.getKey,
    });
    await rejects(await fixture.sign(validClaims()));
  });
});
