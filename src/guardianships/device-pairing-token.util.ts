import { createHmac, hkdfSync, randomBytes } from 'node:crypto';

/** HKDF `info` that scopes the derived key to this feature. */
export const DEVICE_PAIRING_TOKEN_KDF_INFO = 'sacdia:device-pairing-token';

/** 16 random bytes = 128 bits, 22 base64url characters. */
const TOKEN_BYTES = 16;
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{22}$/;

/** A fresh pairing token (128 bits from the OS CSPRNG), shown once as a QR. */
export function generatePairingToken(): string {
  return randomBytes(TOKEN_BYTES).toString('base64url');
}

/** True when the value could be a pairing token at all (cheap pre-check, no DB). */
export function isWellFormedPairingToken(value: unknown): value is string {
  return typeof value === 'string' && TOKEN_PATTERN.test(value);
}

/**
 * Key for the token hash, derived from BETTER_AUTH_SECRET with HKDF (distinct
 * `info`, so it is unrelated to the link-code key) so no new environment
 * variable is needed and the secret is never used raw.
 */
export function deriveDevicePairingTokenKey(secret: string): Buffer {
  return Buffer.from(
    hkdfSync(
      'sha256',
      secret,
      Buffer.alloc(0),
      DEVICE_PAIRING_TOKEN_KDF_INFO,
      32,
    ),
  );
}

/** HMAC-SHA256 hex digest (64 chars) of a pairing token. Only this is stored. */
export function hashPairingToken(token: string, key: Buffer): string {
  return createHmac('sha256', key).update(token).digest('hex');
}

/** The deep link the QR carries. The token is the only secret in it. */
export function pairingQrPayload(token: string): string {
  return `sacdia://pair?t=${token}`;
}
