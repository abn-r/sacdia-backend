import {
  decryptTotpSecret,
  encryptTotpSecret,
  TotpSecretCipherError,
} from './totp-secret-cipher';

/** In-memory form of the `verification.value` of a `totp:{userId}` row. */
export interface TotpRecord {
  secret: string;
  /** bcrypt hashes of the one-time backup codes. */
  backupCodes: string[];
  /** True when the row stores the secret in plaintext (legacy shape). */
  legacy: boolean;
}

/**
 * Single place that knows the stored shape of the TOTP row value:
 *   encrypted: { secretEnc: "v1:...", backupCodes: string[] }
 *   legacy:    { secret: "BASE32", backupCodes: string[] }  (no key configured)
 * Throws TotpSecretCipherError when the row cannot be read.
 */
export function parseTotpRecord(
  value: string,
  identifier: string,
  key: Buffer | null,
): TotpRecord {
  let raw: unknown;
  try {
    raw = JSON.parse(value);
  } catch {
    throw new TotpSecretCipherError('MALFORMED');
  }
  if (!raw || typeof raw !== 'object') {
    throw new TotpSecretCipherError('MALFORMED');
  }
  const obj = raw as Record<string, unknown>;
  const backupCodes = Array.isArray(obj.backupCodes)
    ? obj.backupCodes.filter((c): c is string => typeof c === 'string')
    : [];

  if (typeof obj.secretEnc === 'string') {
    if (!key) throw new TotpSecretCipherError('KEY_MISSING');
    return {
      secret: decryptTotpSecret(obj.secretEnc, identifier, key),
      backupCodes,
      legacy: false,
    };
  }
  if (typeof obj.secret === 'string' && obj.secret.length > 0) {
    return { secret: obj.secret, backupCodes, legacy: true };
  }
  throw new TotpSecretCipherError('MALFORMED');
}

/**
 * Builds the row value. With a key the secret is always encrypted and the
 * plaintext `secret` field is never written; without one (dev/test only)
 * the legacy shape is produced.
 */
export function serializeTotpRecord(
  record: { secret: string; backupCodes: string[] },
  identifier: string,
  key: Buffer | null,
): string {
  if (key) {
    return JSON.stringify({
      secretEnc: encryptTotpSecret(record.secret, identifier, key),
      backupCodes: record.backupCodes,
    });
  }
  return JSON.stringify({
    secret: record.secret,
    backupCodes: record.backupCodes,
  });
}
