import {
  SignJWT,
  createLocalJWKSet,
  exportJWK,
  generateKeyPair,
  type JWTPayload,
  type JWTVerifyGetKey,
} from 'jose';

/**
 * Local RS256 key pair + JWKS resolver, so verifier specs never touch the
 * network. `extractable: true` is required to export the public JWK.
 */
export interface IdTokenFixture {
  getKey: JWTVerifyGetKey;
  sign: (claims: JWTPayload & { kid?: string }) => Promise<string>;
  /** A second key the JWKS does not know — for "unknown kid" cases. */
  signWithUnknownKey: (claims: JWTPayload) => Promise<string>;
}

export async function createIdTokenFixture(): Promise<IdTokenFixture> {
  const known = await generateKeyPair('RS256', { extractable: true });
  const unknown = await generateKeyPair('RS256', { extractable: true });
  const jwk = await exportJWK(known.publicKey);
  const getKey = createLocalJWKSet({
    keys: [{ ...jwk, kid: 'known-kid', alg: 'RS256', use: 'sig' }],
  });

  // jose 6 returns CryptoKey (the KeyLike alias was removed in v6).
  const sign =
    (privateKey: CryptoKey, kid: string) =>
    async ({ kid: overrideKid, ...claims }: JWTPayload & { kid?: string }) =>
      new SignJWT(claims)
        .setProtectedHeader({ alg: 'RS256', kid: overrideKid ?? kid })
        .setIssuedAt()
        .sign(privateKey);

  return {
    getKey,
    sign: sign(known.privateKey, 'known-kid'),
    signWithUnknownKey: sign(unknown.privateKey, 'unknown-kid'),
  };
}

export const FUTURE = Math.floor(Date.now() / 1000) + 300;
export const PAST = Math.floor(Date.now() / 1000) - 300;
