import { createHmac, hkdfSync, randomInt } from 'node:crypto';

/** Crockford base32 without I, L, O, U: 32 symbols, 5 bits each. */
const CROCKFORD_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const CODE_LENGTH = 8;
const NORMALIZED_PATTERN = /^[0-9ABCDEFGHJKMNPQRSTVWXYZ]{8}$/;

/** HKDF `info` that scopes the derived key to this feature. */
export const LINK_CODE_KDF_INFO = 'sacdia:guardianship-link-code';

/** A fresh 40-bit code, uniformly random (`randomInt` has no modulo bias). */
export function generateLinkCode(): string {
  let code = '';
  for (let index = 0; index < CODE_LENGTH; index += 1) {
    code += CROCKFORD_ALPHABET[randomInt(CROCKFORD_ALPHABET.length)];
  }
  return code;
}

/** `7KQ4M9TX` -> `7KQ4-M9TX`, the shape shown to people. */
export function formatLinkCode(normalized: string): string {
  return `${normalized.slice(0, 4)}-${normalized.slice(4)}`;
}

/**
 * Canonical form of whatever a person typed: uppercase, no dashes or spaces,
 * and the look-alike letters Crockford folds (O -> 0, I and L -> 1).
 */
export function normalizeLinkCode(input: string): string {
  return input
    .toUpperCase()
    .replace(/[\s-]/g, '')
    .replace(/O/g, '0')
    .replace(/[IL]/g, '1');
}

/** True when the normalized value could be a code at all (cheap pre-check). */
export function isWellFormedLinkCode(normalized: string): boolean {
  return NORMALIZED_PATTERN.test(normalized);
}

/**
 * Key for the code hash, derived from BETTER_AUTH_SECRET with HKDF so no new
 * environment variable is needed and the secret is never used raw.
 */
export function deriveLinkCodeKey(secret: string): Buffer {
  return Buffer.from(
    hkdfSync('sha256', secret, Buffer.alloc(0), LINK_CODE_KDF_INFO, 32),
  );
}

/** HMAC-SHA256 hex digest (64 chars) of a NORMALIZED code. */
export function hashLinkCode(normalized: string, key: Buffer): string {
  return createHmac('sha256', key).update(normalized).digest('hex');
}
