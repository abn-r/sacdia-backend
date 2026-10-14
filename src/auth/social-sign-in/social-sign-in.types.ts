import { createHash } from 'crypto';

/**
 * Native social sign-in (mobile app).
 *
 * The app obtains an OpenID `idToken` from the Google or Apple SDK and will
 * post it to `POST /auth/oauth/:provider/token` (the endpoint is added in
 * slice B2). The backend verifies the token itself (jose + the provider JWKS)
 * and owns the users/accounts rows.
 * Better Auth is not involved.
 */

export const SOCIAL_PROVIDERS = ['google', 'apple'] as const;
export type SocialProvider = (typeof SOCIAL_PROVIDERS)[number];

export function isSocialProvider(value: string): value is SocialProvider {
  return (SOCIAL_PROVIDERS as readonly string[]).includes(value);
}

/** Claims SACDIA keeps from a verified provider id token. */
export interface VerifiedIdentity {
  provider: SocialProvider;
  /** Provider subject. Stable per user; stored as `accounts.account_id`. */
  sub: string;
  email: string | null;
  emailVerified: boolean;
  givenName?: string;
  familyName?: string;
  picture?: string;
}

export interface IdTokenVerifier {
  readonly provider: SocialProvider;
  /**
   * Verifies signature, issuer, audience, expiry and nonce.
   * Throws AppUnauthorizedException(AUTH_INVALID_TOKEN) on any mismatch and
   * AppServiceUnavailableException(AUTH_OAUTH_PROVIDER_UNAVAILABLE) when the
   * provider JWKS cannot be fetched.
   */
  verify(idToken: string, nonce: string): Promise<VerifiedIdentity>;
}

/** Nest DI tokens. String tokens match the `'BETTER_AUTH_INSTANCE'` style. */
export const GOOGLE_ID_TOKEN_VERIFIER = 'GOOGLE_ID_TOKEN_VERIFIER';
export const APPLE_ID_TOKEN_VERIFIER = 'APPLE_ID_TOKEN_VERIFIER';

/** Splits a comma-separated env value, trimming and dropping empties. */
export function parseCsv(value: string | undefined): string[] {
  return (value ?? '')
    .split(',')
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

/** First 8 chars of a subject — enough to correlate logs, never the full id. */
export function truncateSub(sub: unknown): string {
  return typeof sub === 'string' ? `${sub.slice(0, 8)}…` : 'unknown';
}

/**
 * The app generates a raw nonce, passes SHA-256(raw) to the Google or Apple SDK
 * and sends the raw nonce to the backend. The id token carries the hash.
 */
export function hashNonce(nonce: string): string {
  return createHash('sha256').update(nonce).digest('hex');
}

/** Id tokens are used right after the SDK returns them; reject older ones. */
export const ID_TOKEN_MAX_AGE = '10m';
export const ID_TOKEN_CLOCK_TOLERANCE = '30s';
