import { randomBytes } from 'crypto';
import {
  decodeTotpEncryptionKey,
  decryptTotpSecret,
  encryptTotpSecret,
  getTotpEncryptionKey,
  TotpSecretCipherError,
} from './totp-secret-cipher';
import { parseTotpRecord, serializeTotpRecord } from './totp-record';

const key = randomBytes(32);
const AAD = 'totp:user-1';

describe('totp-secret-cipher', () => {
  it('round-trips', () => {
    const payload = encryptTotpSecret('JBSWY3DPEHPK3PXP', AAD, key);
    expect(payload.startsWith('v1:')).toBe(true);
    expect(payload.split(':')).toHaveLength(4);
    expect(payload).not.toContain('JBSWY3DPEHPK3PXP');
    expect(decryptTotpSecret(payload, AAD, key)).toBe('JBSWY3DPEHPK3PXP');
  });

  it('uses a different IV every time', () => {
    const a = encryptTotpSecret('SECRET', AAD, key);
    const b = encryptTotpSecret('SECRET', AAD, key);
    expect(a).not.toBe(b);
    expect(a.split(':')[1]).not.toBe(b.split(':')[1]);
  });

  it('fails with the wrong key', () => {
    const payload = encryptTotpSecret('SECRET', AAD, key);
    expect(() => decryptTotpSecret(payload, AAD, randomBytes(32))).toThrow(
      TotpSecretCipherError,
    );
  });

  it('fails when the ciphertext is tampered', () => {
    const [v, iv, tag, ct] = encryptTotpSecret('SECRET', AAD, key).split(':');
    const bytes = Buffer.from(ct, 'base64url');
    bytes[0] ^= 0xff;
    const tampered = [v, iv, tag, bytes.toString('base64url')].join(':');
    expect(() => decryptTotpSecret(tampered, AAD, key)).toThrow(
      TotpSecretCipherError,
    );
  });

  it('fails when the tag is tampered', () => {
    const [v, iv, tag, ct] = encryptTotpSecret('SECRET', AAD, key).split(':');
    const bytes = Buffer.from(tag, 'base64url');
    bytes[0] ^= 0xff;
    const tampered = [v, iv, bytes.toString('base64url'), ct].join(':');
    expect(() => decryptTotpSecret(tampered, AAD, key)).toThrow(
      TotpSecretCipherError,
    );
  });

  it("fails with another user's identifier (AAD)", () => {
    const payload = encryptTotpSecret('SECRET', AAD, key);
    expect(() => decryptTotpSecret(payload, 'totp:user-2', key)).toThrow(
      TotpSecretCipherError,
    );
  });

  it.each(['', 'garbage', 'v2:a:b:c', 'v1:a:b', 'v1:AAAA:BBBB:CCCC'])(
    'rejects malformed payload %j',
    (payload) => {
      expect(() => decryptTotpSecret(payload, AAD, key)).toThrow(
        TotpSecretCipherError,
      );
    },
  );

  it('does not leak the secret in the error', () => {
    const payload = encryptTotpSecret('TOPSECRETVALUE', AAD, key);
    try {
      decryptTotpSecret(payload, 'other', key);
    } catch (e) {
      expect((e as Error).message).not.toContain('TOPSECRETVALUE');
    }
  });
});

describe('decodeTotpEncryptionKey / getTotpEncryptionKey', () => {
  it('accepts 32 bytes of base64 and rejects other lengths or junk', () => {
    expect(
      decodeTotpEncryptionKey(randomBytes(32).toString('base64')),
    ).toHaveLength(32);
    expect(
      decodeTotpEncryptionKey(randomBytes(16).toString('base64')),
    ).toBeNull();
    expect(
      decodeTotpEncryptionKey(randomBytes(33).toString('base64')),
    ).toBeNull();
    expect(decodeTotpEncryptionKey('not base64!')).toBeNull();
  });

  it('returns null when unset or empty', () => {
    expect(getTotpEncryptionKey({})).toBeNull();
    expect(getTotpEncryptionKey({ TOTP_ENCRYPTION_KEY: '' })).toBeNull();
    expect(
      getTotpEncryptionKey({ TOTP_ENCRYPTION_KEY: key.toString('base64') }),
    ).toEqual(key);
  });
});

describe('totp-record codec', () => {
  const rec = { secret: 'JBSWY3DPEHPK3PXP', backupCodes: ['h1', 'h2'] };

  it('serializes encrypted with a key and keeps backup codes', () => {
    const value = serializeTotpRecord(rec, AAD, key);
    const raw = JSON.parse(value);
    expect(raw.secret).toBeUndefined();
    expect(raw.secretEnc).toMatch(/^v1:/);
    expect(value).not.toContain(rec.secret);
    expect(parseTotpRecord(value, AAD, key)).toEqual({
      ...rec,
      legacy: false,
    });
  });

  it('serializes the legacy shape without a key and parses it as legacy', () => {
    const value = serializeTotpRecord(rec, AAD, null);
    expect(JSON.parse(value).secretEnc).toBeUndefined();
    expect(parseTotpRecord(value, AAD, key)).toEqual({ ...rec, legacy: true });
  });

  it('fails when an encrypted row is read without a key', () => {
    const value = serializeTotpRecord(rec, AAD, key);
    expect(() => parseTotpRecord(value, AAD, null)).toThrow(
      expect.objectContaining({ code: 'KEY_MISSING' }),
    );
  });

  it('fails when the row is copied to another identifier', () => {
    const value = serializeTotpRecord(rec, AAD, key);
    expect(() => parseTotpRecord(value, 'totp:user-2', key)).toThrow(
      TotpSecretCipherError,
    );
  });

  it.each(['not json', '"str"', '{}', '{"secret":""}'])(
    'rejects malformed value %j',
    (value) => {
      expect(() => parseTotpRecord(value, AAD, key)).toThrow(
        TotpSecretCipherError,
      );
    },
  );
});
