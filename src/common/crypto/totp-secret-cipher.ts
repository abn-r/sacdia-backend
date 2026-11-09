import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const VERSION = 'v1';
const IV_BYTES = 12;
const TAG_BYTES = 16;
const KEY_BYTES = 32;

export type TotpSecretCipherErrorCode =
  'KEY_MISSING' | 'MALFORMED' | 'DECRYPT_FAILED';

/** Typed failure of the TOTP secret cipher. Never carries secret material. */
export class TotpSecretCipherError extends Error {
  constructor(readonly code: TotpSecretCipherErrorCode) {
    super(`TOTP secret cipher failure: ${code}`);
    this.name = 'TotpSecretCipherError';
  }
}

/**
 * `TOTP_ENCRYPTION_KEY` is standard base64 of 32 random bytes
 * (`openssl rand -base64 32`). Returns null when it is not canonical base64
 * or does not decode to exactly 32 bytes.
 */
export function decodeTotpEncryptionKey(value: string): Buffer | null {
  const trimmed = value.trim();
  if (
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(
      trimmed,
    )
  ) {
    return null;
  }
  const decoded = Buffer.from(trimmed, 'base64');
  if (decoded.toString('base64') !== trimmed) return null;
  if (decoded.byteLength !== KEY_BYTES) return null;
  return decoded;
}

/**
 * Reads the key from the environment. Null when unset/empty (dev and test).
 * A value that is set but invalid also yields null: env validation rejects
 * that at boot, so this is only reachable outside the Nest bootstrap.
 */
export function getTotpEncryptionKey(
  env: NodeJS.ProcessEnv = process.env,
): Buffer | null {
  const raw = env.TOTP_ENCRYPTION_KEY;
  if (!raw || !raw.trim()) return null;
  return decodeTotpEncryptionKey(raw);
}

/**
 * Encrypts a TOTP secret with AES-256-GCM.
 * `aad` (the verification identifier) binds the ciphertext to one user.
 * Output: `v1:<iv>:<tag>:<ciphertext>`, each part base64url.
 */
export function encryptTotpSecret(
  plain: string,
  aad: string,
  key: Buffer,
): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, iv, {
    authTagLength: TAG_BYTES,
  });
  cipher.setAAD(Buffer.from(aad, 'utf8'));
  const ciphertext = Buffer.concat([
    cipher.update(plain, 'utf8'),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return [
    VERSION,
    iv.toString('base64url'),
    tag.toString('base64url'),
    ciphertext.toString('base64url'),
  ].join(':');
}

/** Decrypts a `v1:` payload. Throws TotpSecretCipherError on any failure. */
export function decryptTotpSecret(
  payload: string,
  aad: string,
  key: Buffer,
): string {
  const parts = payload.split(':');
  if (parts.length !== 4 || parts[0] !== VERSION) {
    throw new TotpSecretCipherError('MALFORMED');
  }
  const iv = Buffer.from(parts[1], 'base64url');
  const tag = Buffer.from(parts[2], 'base64url');
  const ciphertext = Buffer.from(parts[3], 'base64url');
  if (iv.byteLength !== IV_BYTES || tag.byteLength !== TAG_BYTES) {
    throw new TotpSecretCipherError('MALFORMED');
  }
  try {
    const decipher = createDecipheriv(ALGORITHM, key, iv, {
      authTagLength: TAG_BYTES,
    });
    decipher.setAAD(Buffer.from(aad, 'utf8'));
    decipher.setAuthTag(tag);
    return Buffer.concat([
      decipher.update(ciphertext),
      decipher.final(),
    ]).toString('utf8');
  } catch {
    throw new TotpSecretCipherError('DECRYPT_FAILED');
  }
}
